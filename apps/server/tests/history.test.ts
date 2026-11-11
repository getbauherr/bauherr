import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let member: Record<string, any>
let call: (user: Record<string, any>, name: string, input: unknown, ua?: string) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
let history: typeof import('../src/lib/history')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  // The plan gate is on in the default pack; this test runs a Ticket through without an approval.
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/bare-pack', import.meta.url))
  testDb = await createTestDb('history')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  history = await import('../src/lib/history')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input, userAgent) => callTool({ payload, user, actor: { kind: 'human' }, userAgent }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session', wipLimits: { plan: 99, build: 99, review: 99, release: 99 } }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, gateOwners: 'owner', stagingUrl: 'https://staging.example', productionGate: true, productionChecks: 'deploy-prod' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: 'createdAt', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const events = async (id: number) => (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: id } }, sort: ['at', 'id'], depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const seed = async (title: string, stage: string | null = 'build') => {
  const issue = await fake.tickets(repo).create({ title, labels: stage ? [`bauherr:stage:${stage}`] : [] })
  return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', ...(stage && { stage }), product, workspace: ws }, ...o })).id as number
}

it('ten parallel records of one change write one event', async () => {
  const id = await seed('parallel', 'plan')
  await Promise.all(Array.from({ length: 10 }, () => history.record(payload, id, { cause: 'test' })))
  expect(await events(id)).toMatchObject([{ stage: 'plan', stageKind: 'plan', phase: 'queued', cause: 'test', executor: 'factory' }])
  expect((await reload(id)).historyKey).toBe('plan|queued')
  await history.record(payload, id, { cause: 'again' })
  expect(await events(id)).toHaveLength(1)
})

it('a record that fails never throws into the caller', async () => {
  await expect(history.record(payload, 999_999, { cause: 'missing' })).resolves.toBeUndefined()
})

it('a stage change a hook missed is written by the gate sweep', async () => {
  const id = await seed('missed hook', 'build')
  await history.record(payload, id, { cause: 'test' })
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  const t = await reload(id)
  expect(await events(id)).toHaveLength(1)
  const { syncGate } = await import('../src/lib/gates')
  await syncGate(payload, t, null)
  expect(await events(id)).toMatchObject([{ stage: 'build' }, { stage: 'review', fromStage: 'build', phase: 'queued', cause: 'sweep', executor: 'factory' }])
})

it('claim_run stores the executor, client, model and provider; the User-Agent fills in the client', async () => {
  const claim = async (args: Record<string, unknown>, ua?: string) => {
    const id = await seed(`claim ${Math.random()}`, 'build')
    const run = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
    await payload.update({ collection: 'runs', where: { and: [{ workspace: { equals: ws } }, { status: { equals: 'awaiting_session' } }, { id: { not_equals: run.id } }] }, data: { status: 'cancelled' }, ...o })
    await call(member, 'claim_run', { runId: run.id, ...args }, ua)
    return { id, run: (await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })) as Record<string, any> }
  }
  const told = await claim({ session: 's1', client: 'claude-code/2.1.0', model: 'claude-sonnet-5', provider: 'anthropic' }, 'ignored/9')
  expect(told.run).toMatchObject({ executor: 'session', clientName: 'claude-code', clientVersion: '2.1.0', model: 'claude-sonnet-5', provider: 'anthropic' })
  expect(await events(told.id)).toMatchObject([{ stage: 'build', phase: 'working', executor: 'session', actor: 's1', cause: 'run:claimed', run: told.run.id }])
  const agent = await claim({}, 'opencode/0.9 (linux)')
  expect(agent.run).toMatchObject({ executor: 'session', clientName: 'opencode', clientVersion: '0.9', model: null, provider: null })
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const claim = async (ticket: number, stage: string) => {
  const run = (await runsOf(ticket)).filter((r) => r.stage === stage).at(-1)!
  const { leaseToken } = await claimOnly(payload, call, member, ws, run.id)
  return { runId: run.id as number, leaseToken: leaseToken as string }
}
const checked = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'].map((area) => ({ area, note: `checked ${area}` }))
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]

it('a Ticket from triage to done leaves contiguous spans, and flow() sums them', async () => {
  const issue = await fake.tickets(repo).create({ title: 'history flow' })
  await poll()
  const id = ((await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>).id as number
  const from = new Date(Date.now() - 60_000).toISOString()

  const triage = await claim(id, 'triage')
  await call(member, 'submit_triage', { ...triage, outcome: 'plan', reason: 'clear' })
  await poll()
  const plan = await claim(id, 'plan')
  await call(member, 'submit_plan', { ...plan, markdown: '## TL;DR\nDecision: d\nRecommendation: r\nWhy:\n- w\nRisk: none\n\n## Goal\nhistory' })
  await call(member, 'finish_run', { ...plan, status: 'succeeded' })
  await poll()
  expect(await reload(id)).toMatchObject({ stage: 'build' })

  const mrFor = async () => {
    const head = `bauherr/${issue.number}-feat`
    if (!(await fake.forge.listBranches(repo)).some((b) => b.name === head)) await fake.forge.createBranch(repo, head)
    fake.commit(repo, head, 'a.ts', `x${Math.random()}`)
    return (await fake.forge.listPullRequests(repo)).find((p) => p.head === head && p.state === 'open') ?? (await fake.forge.openPullRequest(repo, { title: 'history flow', body: 'Done\n\n## Evidence\n| Goal | verified |\n', head, base: 'main' }))
  }
  const build = await claim(id, 'build')
  const pr = await mrFor()
  fake.setChecks(repo, pr.headSha, green)
  await call(member, 'finish_run', { ...build, status: 'succeeded', prUrl: pr.url })
  const review = await claim(id, 'review')
  await call(member, 'submit_review', { ...review, verdict: 'clean', findings: [], checked, markdown: 'clean' })
  await release.watchRelease(payload)
  fake.setChecks(repo, (await reload(id)).mergeSha, green)
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await reload(id)).toMatchObject({ stage: 'release', productionState: 'awaiting_approval' })
  await actions.approveProduction(payload, member, { ticket: id })
  fake.setChecks(repo, (await reload(id)).mergeSha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'success', startedAt: new Date(Date.now() + 5000).toISOString() }])
  await release.watchProduction(payload, Date.now() + 1000)
  await release.watchProduction(payload, Date.now() + 2000)
  expect(await reload(id)).toMatchObject({ stage: 'done', state: 'closed' })

  const rows = await events(id)
  expect(rows.map((e) => [e.stage, e.phase, e.executor, e.cause])).toEqual([
    ['triage', 'queued', 'factory', 'poll'],
    ['triage', 'working', 'session', 'run:claimed'],
    ['plan', 'queued', 'factory', 'moveStage:triage'],
    ['plan', 'working', 'session', 'run:claimed'],
    ['plan', 'queued', 'factory', 'run:finished'],
    ['build', 'queued', 'factory', 'moveStage:plan_accepted'],
    ['build', 'working', 'session', 'run:claimed'],
    ['review', 'queued', 'factory', 'moveStage:request_review'],
    ['review', 'working', 'session', 'run:claimed'],
    ['release', 'ci', 'ci', 'moveStage:merged'],
    ['release', 'queued', 'factory', 'release:on_staging'],
    ['release', 'human', 'human', 'staging:accepted'],
    ['release', 'ci', 'human', 'gate:approve:production'],
    ['release', 'queued', 'factory', 'production:deployed'],
    ['done', 'closed', 'factory', 'moveStage:production_deployed'],
  ])
  expect(rows.filter((e) => e.phase === 'working').map((e) => e.actor)).toEqual(Array(4).fill('m@x.io'))
  expect(rows.find((e) => e.cause === 'gate:approve:production')).toMatchObject({ actor: 'm@x.io', fromStage: 'release' })
  expect(rows.find((e) => e.cause === 'moveStage:merged')).toMatchObject({ fromStage: 'review', stageKind: 'release' })
  const spans = await history.timeline(payload, id)
  expect(spans.slice(0, -1).every((s, i) => s.until === spans[i + 1]!.at)).toBe(true)
  const out = await history.flow(payload, ws, { from, to: new Date(Date.now() + 60_000).toISOString() })
  const mine = out.tickets.find((t) => t.ticket === id)!
  const total = spans.reduce((a, s) => a + s.seconds, 0)
  const triaged = spans.filter((s) => s.stageKind === 'triage').reduce((a, s) => a + s.seconds, 0)
  expect(mine.leadTimeSec).toBeCloseTo(total, 3)
  expect(mine.cycleTimeSec).toBeCloseTo(total - triaged, 3)
  expect(out.stages.find((s) => s.stage === 'build')).toMatchObject({ tickets: expect.any(Number), phases: { working: { medianSec: expect.any(Number), p85Sec: expect.any(Number) } } })
  expect(out.throughput).toEqual([{ week: expect.stringMatching(/^\d{4}-W\d{2}$/), tickets: 1 }])
  expect(mine.stages.reduce((a, s) => a + s.seconds, 0)).toBeCloseTo(total, 3)
})
