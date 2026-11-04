import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { needsYou } from '../src/app/(app)/lib/needs-you'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let liveness: typeof import('../src/lib/liveness')
let actions: typeof import('../src/lib/actions')
let call: (actor: unknown, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const EVIDENCE = 'x\n\n## Evidence\n| Goal | verified |\n'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('liveness')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  liveness = await import('../src/lib/liveness')
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (actor, name, input) => callTool({ payload, user: member, actor: actor as never }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'admin', tenants: [{ tenant: ws }] }, ...o })
  const token = await (await import('../src/lib/api-key')).mintAgentKey(payload, member as never, 'liveness')
  agent = { kind: 'agent', keyId: (await (await import('../src/lib/api-key')).resolveAgentKey(payload, token))!.keyId }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

let agent: { kind: 'agent'; keyId: number | string }
const comments = async (n: string) => (await fake.tickets(repo).listComments(n)).map((c) => c.body)
const liveComments = async (n: string) => (await comments(n)).filter((c) => c.includes('bauherr:liveness'))
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, sort: 'createdAt', depth: 0, ...o })).docs as Record<string, any>[]
const causeOf = async (id: number) => (await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === id)?.cause

/** An open Ticket in `stage` with the Runs given (oldest first) and, for review, an MR the fake forge knows. */
const seed = async (stage: 'plan' | 'build' | 'review', o2: { reviewState?: string; runs?: Record<string, any>[]; mr?: 'open' | 'closed' | 'none'; checks?: any[] } = {}) => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title: `dead ${stage}`, labels: [`bauherr:stage:${stage}`] })
  const t = await payload.create({ collection: 'tickets', data: { title: `dead ${stage}`, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, reviewState: o2.reviewState, product, workspace: ws }, ...o })
  let pr: Awaited<ReturnType<typeof fake.forge.openPullRequest>> | null = null
  if (o2.mr && o2.mr !== 'none') {
    const branch = `bauherr/${issue.number}-feat`
    await fake.forge.createBranch(repo, branch)
    fake.commit(repo, branch, 'a.ts', 'x')
    pr = await fake.forge.openPullRequest(repo, { title: 'mr', body: EVIDENCE, head: branch, base: 'main' })
    if (o2.checks) fake.setChecks(repo, pr.headSha, o2.checks)
    if (o2.mr === 'closed') await fake.forge.closePullRequest(repo, pr.number)
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  }
  for (const r of o2.runs ?? []) await payload.create({ collection: 'runs', data: { ticket: t.id, mode: 'session', workspace: ws, ...r }, ...o })
  return { id: t.id as number, n: String(issue.number), pr, number: issue.number as number }
}

it('mr-missing: the MR was closed and a replacement is open: it is relinked and the review starts, once', async () => {
  const { id, n, number } = await seed('review', { reviewState: 'needs_human', mr: 'closed' })
  expect(await causeOf(id)).toBe('mr-missing')
  const branch = `bauherr/${number}-again`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'b.ts', 'y')
  const next = await fake.forge.openPullRequest(repo, { title: 'again', body: EVIDENCE, head: branch, base: 'main' })
  expect(await liveness.sweepLiveness(payload)).toBeGreaterThanOrEqual(1)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: null })
  expect((await runs(id, 'build')).some((r) => r.artifacts?.prUrl === next.url)).toBe(true)
  expect(await runs(id, 'review')).toHaveLength(1)
  expect(await liveComments(n)).toHaveLength(1)
  await liveness.sweepLiveness(payload)
  expect(await liveComments(n)).toHaveLength(1)
  expect(await runs(id, 'review')).toHaveLength(1)
})

it('mr-missing with no replacement goes back to Build with the note to open a new MR', async () => {
  const { id, n } = await seed('review', { reviewState: 'needs_human', mr: 'closed' })
  await liveness.sweepLiveness(payload)
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null })
  expect((await runs(id, 'build')).some((r) => r.status === 'awaiting_session')).toBe(true)
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('Open a new MR on a `bauherr/')
  expect((await fake.tickets(repo).get(n)).labels).toContain('bauherr:stage:build')
  expect(await liveComments(n)).toHaveLength(1)
})

it('mr-missing: a review Ticket that was never linked to an MR is repaired too', async () => {
  const { id } = await seed('review')
  expect(await causeOf(id)).toBe('mr-missing')
})

it('checks-red: back to Build on the same MR with the failing checks, no review round counted', async () => {
  const { id, n, pr } = await seed('review', { reviewState: 'needs_human', mr: 'open', checks: [{ name: 'e2e', status: 'completed', conclusion: 'failure' }] })
  expect(await causeOf(id)).toBe('checks-red')
  await liveness.sweepLiveness(payload)
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, reviewRounds: 0 })
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('Checks failed on the MR head: e2e')
  expect((await fake.forge.getPullRequest(repo, pr!.number)).state).toBe('open')
  expect(await liveComments(n)).toHaveLength(1)
})

it('a repair that throws leaves no marker: the next pass retries it', async () => {
  const { id, n } = await seed('review', { reviewState: 'needs_human', mr: 'open', checks: [{ name: 'e2e', status: 'completed', conclusion: 'failure' }] })
  const real = fake.forge.listChecks
  let calls = 0
  fake.forge.listChecks = async (...a) => {
    // 1st call classifies the Ticket, the 2nd is the repair's own read
    if (++calls === 2) throw new Error('forge down')
    return real(...a)
  }
  try {
    await liveness.sweepLiveness(payload)
    expect(await liveComments(n)).toHaveLength(0)
    expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human' })
    await liveness.sweepLiveness(payload)
  } finally {
    fake.forge.listChecks = real
  }
  expect(await reload(id)).toMatchObject({ stage: 'build' })
  expect(await liveComments(n)).toHaveLength(1)
})

it('mr-missing links the newest open replacement MR', async () => {
  const { id, number } = await seed('review', { reviewState: 'needs_human', mr: 'closed' })
  const urls: string[] = []
  for (const suffix of ['a', 'b']) {
    const branch = `bauherr/${number}-${suffix}`
    await fake.forge.createBranch(repo, branch)
    fake.commit(repo, branch, `${suffix}.ts`, suffix)
    urls.push((await fake.forge.openPullRequest(repo, { title: suffix, body: EVIDENCE, head: branch, base: 'main' })).url)
  }
  await liveness.sweepLiveness(payload)
  expect((await runs(id, 'build')).some((r) => r.artifacts?.prUrl === urls[1])).toBe(true)
})

it('review-escalated (MR open, checks not red): not repaired, shown as "Needs you"; Back to build moves it', async () => {
  const { id, n } = await seed('review', { reviewState: 'needs_human', mr: 'open', checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }] })
  const dead = (await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === id)!
  expect(dead).toMatchObject({ cause: 'review-escalated', need: 'Needs you' })
  await liveness.sweepLiveness(payload)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human' })
  expect(await liveComments(n)).toHaveLength(0)
  expect(await actions.backToBuild(payload, member, { ticket: id, note: 'try the other approach' })).toEqual({ outcome: 'build' })
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, reviewRounds: 0 })
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('try the other approach')
})

it('run-failed: one successor Run; the second failure in a row stays a need', async () => {
  const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'failed', error: 'boom' }] })
  expect(await causeOf(id)).toBe('run-failed')
  await liveness.sweepLiveness(payload)
  const [failed, successor] = await runs(id, 'build')
  expect(successor).toMatchObject({ status: 'awaiting_session' })
  expect(successor!.previousRun).toBe(failed!.id)
  expect(await liveComments(n)).toHaveLength(1)
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'build')).toHaveLength(2)
  await payload.update({ collection: 'runs', id: successor!.id, data: { status: 'failed', error: 'boom again' }, ...o })
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'build')).toHaveLength(2)
  expect(await causeOf(id)).toBe('run-failed')
  expect(needsYou({ stage: 'build', labels: [] }, { stage: 'build', status: 'failed' })).toBe('Run failed')
})

it('run-cancelled: not repaired, shown as "Cancelled" with its reason', async () => {
  const { id, n } = await seed('build', { runs: [{ stage: 'build', status: 'cancelled', error: 'waiting for the owner' }] })
  const dead = (await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === id)!
  expect(dead).toMatchObject({ cause: 'run-cancelled', need: 'Cancelled' })
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'build')).toHaveLength(1)
  expect(await liveComments(n)).toHaveLength(0)
  const live = await seed('build', { runs: [{ stage: 'build', status: 'awaiting_session' }] })
  await expect(actions.backToBacklog(payload, member, { ticket: live.id })).rejects.toThrow(/not cancelled/)
  expect(await actions.backToBacklog(payload, member, { ticket: id })).toEqual({ stage: 'triage' })
  expect(await reload(id)).toMatchObject({ stage: 'triage' })
})

it('a Ticket with a live Run, a wait or a stage-mismatched Run is not dead', async () => {
  const live = await seed('build', { runs: [{ stage: 'build', status: 'failed' }, { stage: 'build', status: 'awaiting_session' }] })
  const waiting = await seed('build', { runs: [{ stage: 'build', status: 'failed' }] })
  await payload.update({ collection: 'tickets', id: waiting.id, data: { waitingFor: 'build' }, ...o })
  const dead = (await liveness.deadTickets(payload, ws)).map((d) => d.ticket.id)
  expect(dead).not.toContain(live.id)
  expect(dead).not.toContain(waiting.id)
})

it('triage-expired: a Ticket whose only Triage Run ended unclaimed is offered again', async () => {
  const at = new Date().toISOString()
  const issue = await fake.tickets(repo).create({ title: 'forgotten' })
  const t = await payload.create({ collection: 'tickets', data: { title: 'forgotten', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', product, workspace: ws, sourceUpdatedAt: at, triagedAt: at, triageAttempts: 3 }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'triage', mode: 'session', workspace: ws, status: 'abandoned', error: 'unclaimed triage expired' }, ...o })
  expect(await causeOf(t.id as number)).toBe('triage-expired')
  await liveness.sweepLiveness(payload)
  expect(await reload(t.id as number)).toMatchObject({ triagedAt: null, triageAttempts: 0 })
  expect(await liveComments(String(issue.number))).toHaveLength(1)
})

it('return_to_build: an agent may repair a mechanical cause, and is refused for a live Ticket', async () => {
  const dead = await seed('review', { reviewState: 'needs_human', mr: 'closed' })
  const live = await seed('build', { runs: [{ stage: 'build', status: 'awaiting_session' }] })
  await expect(call(agent, 'return_to_build', { ticket: live.id, reason: 'x' })).rejects.toThrow(/not dead/)
  expect(await call(agent, 'return_to_build', { ticket: dead.id, reason: 'MR closed' })).toEqual({ outcome: 'build' })
  expect(await reload(dead.id)).toMatchObject({ stage: 'build' })
  const cancelled = await seed('build', { runs: [{ stage: 'build', status: 'cancelled' }] })
  await expect(call(agent, 'return_to_build', { ticket: cancelled.id, reason: 'x' })).rejects.toThrow(/not dead for a mechanical cause/)
})

it('after one pass no repairable Ticket stays dead without a need', async () => {
  await seed('review', { reviewState: 'needs_human', mr: 'closed' })
  await seed('build', { runs: [{ stage: 'build', status: 'failed', error: 'x' }] })
  await liveness.sweepLiveness(payload)
  expect(await liveness.invisibleDead(payload, ws)).toEqual([])
})
