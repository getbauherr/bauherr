import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { needsYou } from '../src/app/(app)/lib/needs-you'
import { createTestDb, type TestDb } from './helpers/test-db'
import { DEFAULT } from '../src/lib/workflow'

const spend = vi.hoisted(() => ({ spentUsd: 0, limitUsd: null as number | null }))
vi.mock('../src/lib/gateway', async (orig) => ({ ...(await orig<typeof import('../src/lib/gateway')>()), budgetStatus: async () => spend }))

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let liveness: typeof import('../src/lib/liveness')
let jobs: typeof import('../src/jobs')
let call: (actor: unknown, name: string, input: unknown) => Promise<any>
let agent: { kind: 'agent'; keyId: number | string }
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const MARKER = '<!-- bauherr:escalation -->'
const EVIDENCE = 'x\n\n## Evidence\n| Goal | verified |\n'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('escalation')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_DATABASE_URL = 'postgres://unused'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  liveness = await import('../src/lib/liveness')
  jobs = await import('../src/jobs')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (actor, name, input) => callTool({ payload, user: member, actor: actor as never }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'admin', tenants: [{ tenant: ws }] }, ...o })
  const keys = await import('../src/lib/api-key')
  agent = { kind: 'agent', keyId: (await keys.resolveAgentKey(payload, await keys.mintAgentKey(payload, member as never, 'escalation')))!.keyId }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, sort: 'id', depth: 0, ...o })).docs as Record<string, any>[]
const ladder = async (n: string) => (await fake.tickets(repo).listComments(n)).map((c) => c.body).find((b) => b.startsWith(MARKER)) ?? ''
const needOf = async (id: number) => (await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === id)?.need

const seed = async (stage: 'plan' | 'build' | 'review', o2: { reviewState?: string; runs?: Record<string, any>[]; mr?: boolean; rounds?: number } = {}) => {
  const issue = await fake.tickets(repo).create({ title: `stuck ${stage}`, labels: [`bauherr:stage:${stage}`] })
  const t = await payload.create({ collection: 'tickets', data: { title: `stuck ${stage}`, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, reviewState: o2.reviewState, reviewRounds: o2.rounds, product, workspace: ws }, ...o })
  if (o2.mr) {
    const branch = `bauherr/${issue.number}-feat`
    await fake.forge.createBranch(repo, branch)
    fake.commit(repo, branch, 'a.ts', 'x')
    const pr = await fake.forge.openPullRequest(repo, { title: 'mr', body: EVIDENCE, head: branch, base: 'main' })
    fake.setChecks(repo, pr.headSha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  }
  for (const r of o2.runs ?? []) await payload.create({ collection: 'runs', data: { ticket: t.id, mode: 'session', workspace: ws, ...r }, ...o })
  return { id: t.id as number, n: String(issue.number) }
}

it('a first Build failure gets one strong retry with doubled caps, noted once; the claim says strong', async () => {
  const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'failed', error: 'ran out of turns' }] })
  expect(await needOf(id)).toBeNull()
  await liveness.sweepLiveness(payload)
  await liveness.sweepLiveness(payload)
  const [failed, retry] = await runs(id, 'build')
  expect(await runs(id, 'build')).toHaveLength(2)
  expect(retry).toMatchObject({ status: 'awaiting_session', previousRun: failed!.id, escalation: { step: 2, reason: 'ran out of turns', previousRuns: [failed!.id] } })
  const body = await ladder(n)
  expect(body.match(/Step 2 of 4/g)).toHaveLength(1)
  expect(body).toContain(`after build Run #${failed!.id} (failed`)
  expect(body).toContain('400 turns, $10')
  const claimed = await call(agent, 'claim_run', { runId: retry!.id })
  expect(claimed.run).toMatchObject({ tier: 'strong', escalation: { step: 2, reason: 'ran out of turns' } })
})

it('a retry whose Comment failed is completed by the next pass: still one Run and one line', async () => {
  const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'failed', error: 'boom' }] })
  const ts = fake.tickets(repo)
  const real = ts.comment.bind(ts)
  ts.comment = async () => {
    throw new Error('forge down')
  }
  await liveness.sweepLiveness(payload)
  ts.comment = real
  expect(await runs(id, 'build')).toHaveLength(1)
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'build')).toHaveLength(2)
  expect((await ladder(n)).match(/Step 2 of 4/g)).toHaveLength(1)
})

it('the ladder: strong retry fails, investigation; investigations used up, the owner with the history', async () => {
  const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'failed', error: 'first' }] })
  await liveness.sweepLiveness(payload)
  const [first, retry] = await runs(id, 'build')
  await payload.update({ collection: 'runs', id: retry!.id, data: { status: 'failed', error: 'second' }, ...o })
  await liveness.sweepLiveness(payload)
  expect((await runs(id, 'plan'))[0]).toMatchObject({ investigation: { failedRuns: [first!.id, retry!.id], stage: 'build' } })
  expect(await ladder(n)).toContain(`Step 3 of 4 after build Run #${retry!.id}`)
  // Two investigations exist: the next failure of a strong Build has no rung left.
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'plan', status: 'succeeded', mode: 'session', workspace: ws, investigation: { failedRuns: [], stage: 'build' } }, ...o })
  await payload.update({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { status: { equals: 'awaiting_session' } }] }, data: { status: 'cancelled' }, ...o })
  await payload.update({ collection: 'tickets', id, data: { stage: 'build' }, ...o })
  const last = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'failed', mode: 'session', workspace: ws, previousRun: retry!.id, escalation: { step: 2, reason: 'x', previousRuns: [] }, error: 'third' }, ...o })
  await liveness.sweepLiveness(payload)
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'plan')).toHaveLength(2)
  expect(await ladder(n)).toContain(`Step 4 of 4: Run #${last.id} to the owner`)
  expect((await ladder(n)).match(/to the owner/g)).toHaveLength(1)
  expect(await needOf(id)).toBe('Run failed')
})

it('a failed plan Run gets one strong retry; its failure goes to the owner', async () => {
  const { id } = await seed('plan', { runs: [{ stage: 'plan', status: 'failed', error: 'p1' }] })
  await liveness.sweepLiveness(payload)
  const [first, retry] = await runs(id, 'plan')
  expect(retry).toMatchObject({ escalation: { step: 2 }, previousRun: first!.id })
  await payload.update({ collection: 'runs', id: retry!.id, data: { status: 'failed', error: 'p2' }, ...o })
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'plan')).toHaveLength(2)
  expect(await needOf(id)).toBe('Run failed')
})

it('needs_human: stuck escalates, decision and access reach the owner, a missing kind counts as decision', async () => {
  const stuck = await seed('build', { runs: [{ stage: 'build', status: 'needs_human', reasonKind: 'stuck', error: 'tests still red after 3 tries' }] })
  const decision = await seed('build', { runs: [{ stage: 'build', status: 'needs_human', reasonKind: 'decision', error: 'D1b?' }] })
  const access = await seed('build', { runs: [{ stage: 'build', status: 'needs_human', reasonKind: 'access', error: 'no token' }] })
  await liveness.sweepLiveness(payload)
  expect(await runs(stuck.id, 'build')).toHaveLength(2)
  expect((await runs(stuck.id, 'build'))[1]).toMatchObject({ escalation: { step: 2, reason: 'tests still red after 3 tries' } })
  for (const t of [decision, access]) expect(await runs(t.id, 'build')).toHaveLength(1)
  expect(needsYou(DEFAULT(), { stage: 'build', labels: [] }, { stage: 'build', status: 'needs_human', reasonKind: 'decision' })).toBe('Run needs you')
  expect(needsYou(DEFAULT(), { stage: 'build', labels: [] }, { stage: 'build', status: 'needs_human', reasonKind: 'access' })).toBe('Run needs you')
  expect(needsYou(DEFAULT(), { stage: 'build', labels: [] }, { stage: 'build', status: 'needs_human', reasonKind: 'stuck' })).toBeNull()
  expect(needsYou(DEFAULT(), { stage: 'build', labels: [] }, { stage: 'build', status: 'needs_human' })).toBe('Run needs you')
})

it('finish_run records reasonKind; a missing one on needs_human is stored as decision and says so', async () => {
  const issue = await seed('build')
  const finish = async (extra: Record<string, unknown>) => {
    const run = await payload.create({ collection: 'runs', data: { ticket: issue.id, stage: 'build', status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
    await payload.update({ collection: 'runs', where: { and: [{ status: { equals: 'awaiting_session' } }, { id: { not_equals: run.id } }] }, data: { status: 'cancelled' }, ...o })
    const { leaseToken } = await call(agent, 'claim_run', { runId: run.id })
    const res = await call(agent, 'finish_run', { runId: run.id, leaseToken, status: 'needs_human', reason: 'why', ...extra })
    return { res, run: (await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })) as Record<string, any> }
  }
  const stuck = await finish({ reasonKind: 'stuck' })
  expect(stuck.run.reasonKind).toBe('stuck')
  expect(stuck.res.note).toBeUndefined()
  const missing = await finish({})
  expect(missing.run.reasonKind).toBe('decision')
  expect(missing.res.note).toMatch(/treated as decision/)
  await expect(finish({ reasonKind: 'nope' })).rejects.toThrow(/reasonKind must be/)
})

it('an abandoned session Run is replaced by a strong one; the second abandon is stuck and escalates', async () => {
  const { id } = await seed('build', { runs: [{ stage: 'build', status: 'running', heartbeatAt: new Date().toISOString() }] })
  const [r1] = await runs(id, 'build')
  expect(await jobs.abandonRun(payload, r1!, { reason: 'lease expired', escalate: true })).toBe('abandoned')
  const [, r2] = await runs(id, 'build')
  expect(r2).toMatchObject({ status: 'awaiting_session', previousRun: r1!.id, escalation: { step: 2, reason: 'lease expired', previousRuns: [r1!.id] } })
  await payload.update({ collection: 'runs', id: r2!.id, data: { status: 'running' }, ...o })
  expect(await jobs.abandonRun(payload, (await runs(id, 'build'))[1]!, { reason: 'lease expired', escalate: true })).toBe('needs_human')
  expect((await runs(id, 'build'))[1]).toMatchObject({ status: 'needs_human', reasonKind: 'stuck' })
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'plan')).toHaveLength(1)
})

it('the review round cap gets one strong fix round with a strong review after it, then the owner', async () => {
  const { id, n } = await seed('review', { reviewState: 'needs_human', mr: true, rounds: 3 })
  await liveness.sweepLiveness(payload)
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null })
  const build = (await runs(id, 'build')).at(-1)!
  expect(build).toMatchObject({ status: 'awaiting_session', escalation: { step: 2, reason: 'review round cap' } })
  expect(await ladder(n)).toContain('Step 2 of 4 after the review round cap')
  await payload.update({ collection: 'runs', id: build.id, data: { status: 'succeeded', artifacts: { prUrl: (await runs(id, 'build'))[0]!.artifacts.prUrl } }, ...o })
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  await jobs.startReviewIfReady(payload, await reload(id))
  expect((await runs(id, 'review'))[0]).toMatchObject({ escalation: { reason: 'review round cap' } })
  await payload.update({ collection: 'runs', id: (await runs(id, 'review'))[0]!.id, data: { status: 'succeeded' }, ...o })
  await payload.update({ collection: 'tickets', id, data: { reviewState: 'needs_human', reviewRounds: 4 }, ...o })
  await liveness.sweepLiveness(payload)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human' })
  expect(await runs(id, 'build')).toHaveLength(2)
  expect(await needOf(id)).toBe('Round cap reached')
})

it('a review parked for an invalid output gets one strong successor review; the second invalid one stays with the owner', async () => {
  const { id, n } = await seed('review', { reviewState: 'ready_for_human', mr: true, runs: [{ stage: 'review', status: 'succeeded', artifacts: { review: { markdown: 'm', problem: 'the review did not account for: evidence' } } }] })
  await liveness.sweepLiveness(payload)
  await liveness.sweepLiveness(payload)
  const reviews = await runs(id, 'review')
  expect(reviews).toHaveLength(2)
  expect(reviews[1]).toMatchObject({ status: 'awaiting_session', previousRun: reviews[0]!.id, escalation: { step: 2 } })
  expect(await reload(id)).toMatchObject({ reviewState: null })
  expect(await ladder(n)).toContain(`after review Run #${reviews[0]!.id} (invalid output)`)
  await payload.update({ collection: 'runs', id: reviews[1]!.id, data: { status: 'succeeded', artifacts: { review: { markdown: 'm', problem: 'again' } } }, ...o })
  await payload.update({ collection: 'tickets', id, data: { reviewState: 'ready_for_human' }, ...o })
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'review')).toHaveLength(2)
})

it('an exhausted Workspace budget sends an autonomous escalation to the owner with "budget"', async () => {
  await payload.update({ collection: 'workspaces', id: ws, data: { defaultMode: 'autonomous' }, ...o })
  try {
    spend.spentUsd = 60
    spend.limitUsd = 50
    const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'failed', mode: 'autonomous', error: 'boom' }] })
    await liveness.sweepLiveness(payload)
    expect(await runs(id, 'build')).toHaveLength(1)
    expect(await ladder(n)).toContain('to the owner (budget)')
    expect((await runs(id, 'build'))[0]).toMatchObject({ reasonKind: 'access' })
    expect(await needOf(id)).toBe('Run failed')
    spend.spentUsd = 1
    const ok = await seed('build', { runs: [{ stage: 'build', status: 'failed', mode: 'autonomous', error: 'boom' }] })
    await liveness.sweepLiveness(payload)
    expect(await runs(ok.id, 'build')).toHaveLength(2)
  } finally {
    await payload.update({ collection: 'workspaces', id: ws, data: { defaultMode: 'session' }, ...o })
  }
})

const ENDS: [string, Record<string, unknown>][] = [
  ['failed', { status: 'failed', error: 'boom' }],
  ['abandoned', { status: 'abandoned', error: 'lease' }],
  ['cancelled', { status: 'cancelled', error: 'timeout' }],
  ...[undefined, 'decision', 'access', 'stuck'].map((k): [string, Record<string, unknown>] => [`needs_human/${k}`, { status: 'needs_human', error: 'q', ...(k && { reasonKind: k }) }]),
]

for (const stage of ['plan', 'build', 'review'] as const) {
  for (const [name, end] of ENDS) {
    it(`invariant: a ${stage} Run that ended ${name} is, after one sweep, escalating, a need or listed by invisibleDead`, async () => {
      const { id } = await seed(stage, { mr: stage === 'review', runs: [{ stage, ...end }] })
      await liveness.sweepLiveness(payload)
      const live = await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { status: { in: ['queued', 'awaiting_session', 'running'] } }] }, ...o })
      const dead = (await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === id)
      expect(live.totalDocs > 0 || !!dead?.need).toBe(true)
      expect((await liveness.invisibleDead(payload, ws)).some((d) => d.ticket.id === id)).toBe(false)
    })
  }
}

it('a failed review Run on a review Ticket without a verdict is escalated to a strong review', async () => {
  const { id } = await seed('review', { mr: true, runs: [{ stage: 'review', status: 'failed', error: 'review run wrote no review.json' }] })
  await liveness.sweepLiveness(payload)
  expect((await runs(id, 'review'))[1]).toMatchObject({ status: 'awaiting_session', escalation: { step: 2 } })
})

it('an unknown blocker kind is a decision', async () => {
  const { checkGoal } = await import('../../../packages/runner/src/goal')
  expect((checkGoal([{ text: 'a', status: 'blocked', reason: 'r', kind: 'Stuck' as never }], false) as { reasonKind: string }).reasonKind).toBe('decision')
})

it('an abandoned session Run writes the strong retry line itself, and the sweep fills it in when it failed', async () => {
  const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'running', heartbeatAt: new Date().toISOString() }] })
  const [r1] = await runs(id, 'build')
  await jobs.abandonRun(payload, r1!, { reason: 'lease expired', escalate: true })
  expect(await ladder(n)).toContain(`Step 2 of 4 after build Run #${r1!.id} (abandoned`)
  const ts = fake.tickets(repo)
  const cmt = (await ts.listComments(n)).find((c) => c.body.startsWith(MARKER))!
  await ts.updateComment(n, cmt.id, MARKER)
  expect(await liveness.sweepLiveness(payload)).toBeGreaterThanOrEqual(1)
  expect(await ladder(n)).toContain(`after build Run #${r1!.id} (abandoned`)
})
