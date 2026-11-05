import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let n = 0
let actions: typeof import('../src/lib/actions')
let liveness: typeof import('../src/lib/liveness')
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const red = [{ name: 'e2e-fake (1)', status: 'completed', conclusion: 'failure' }]
const running = [{ name: 'ci', status: 'in_progress', conclusion: null }]

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('green_heads')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  liveness = await import('../src/lib/liveness')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', wipLimits: {}, defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, checkRetries: 0 }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  for (const pr of await fake.forge.listPullRequests(repo, 'open')) await fake.forge.closePullRequest(repo, pr.number)
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: null }, ...o })
})

/** A claimed session Build Run and an open factory MR whose head carries `checks`. */
const seed = async (checks: any[]) => {
  const issue = await fake.tickets(repo).create({ title: `t${++n}`, labels: ['bauherr:stage:build'] })
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const head = `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, head)
  fake.commit(repo, head, 'src/a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 't', body: '## Evidence\nx', head, base: 'main' })
  fake.setChecks(repo, pr.headSha, checks)
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  await payload.update({ collection: 'runs', where: { and: [{ workspace: { equals: ws } }, { status: { equals: 'awaiting_session' } }, { id: { not_equals: run.id } }] }, data: { status: 'cancelled' }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  return { id: ticket.id as number, n: String(issue.number), a: { runId: run.id, leaseToken }, pr }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, sort: 'createdAt', depth: 0, ...o })).docs as Record<string, any>[]

it('red checks: request_review is refused, the Ticket stays in Build, no Review Run and no round', async () => {
  const { id, a } = await seed(red)
  expect(await call(member, 'request_review', a)).toMatchObject({ stage: 'build', refused: 'checks red: e2e-fake (1)', checks: ['e2e-fake (1)'] })
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewRounds: 0 })
  expect(await runs(id, 'review')).toHaveLength(0)
})

it('finish_run keeps the Run running while the head is red', async () => {
  const { id, a, pr } = await seed(red)
  await expect(call(member, 'finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).rejects.toThrow(/checks red: e2e-fake \(1\)/)
  expect((await payload.findByID({ collection: 'runs', id: a.runId, ...o })).status).toBe('running')
  expect((await reload(id)).stage).toBe('build')
})

it('pending checks: the Ticket waits in Build for checks, then goes to Review once they are green', async () => {
  const { id, a, pr } = await seed(running)
  expect(await call(member, 'request_review', a)).toMatchObject({ stage: 'build', waiting: 'checks' })
  expect(await reload(id)).toMatchObject({ stage: 'build', waitingFor: 'checks' })
  expect(await runs(id, 'review')).toHaveLength(0)
  expect(await actions.watchChecks(payload)).toBe(0)
  expect((await reload(id)).waitingFor).toBe('checks')
  expect((await liveness.deadTickets(payload, ws)).some((d) => d.ticket.id === id)).toBe(false)
  fake.setChecks(repo, pr.headSha, green)
  expect(await actions.watchChecks(payload)).toBe(1)
  expect(await reload(id)).toMatchObject({ stage: 'review', waitingFor: null })
  expect(await runs(id, 'review')).toHaveLength(1)
})

it('pending then red: back to Build with the failing names and a new Build Run, no review round', async () => {
  const { id, n: num, a, pr } = await seed(running)
  await call(member, 'request_review', a)
  fake.setChecks(repo, pr.headSha, red)
  expect(await actions.watchChecks(payload)).toBe(1)
  expect(await reload(id)).toMatchObject({ stage: 'build', waitingFor: null, reviewRounds: 0 })
  // the session's own Build Run is still running here, so no second one is queued: the same Build continues
  expect((await runs(id, 'build')).some((r) => ['running', 'awaiting_session'].includes(r.status))).toBe(true)
  expect(await runs(id, 'review')).toHaveLength(0)
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('e2e-fake (1)')
  void num
})

it('pending for more than 2 hours: the Build Run needs a human with the reason', async () => {
  const { id, a } = await seed(running)
  await call(member, 'request_review', a)
  await actions.watchChecks(payload, Date.now() + 3 * 3_600_000)
  expect(await reload(id)).toMatchObject({ waitingFor: null })
  expect((await runs(id, 'build')).at(-1)).toMatchObject({ status: 'needs_human' })
})

it('green checks go straight to Review', async () => {
  const { id, a } = await seed(green)
  expect(await call(member, 'request_review', a)).toMatchObject({ stage: 'review' })
  expect(await runs(id, 'review')).toHaveLength(1)
})

it('the ran rule: the Evidence must show each required command with exit code 0 and the pushed SHA', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: { ran: ['pnpm typecheck', 'pnpm test'] } }, ...o })
  const { id, a, pr } = await seed(green)
  await payload.update({ collection: 'runs', id: a.runId, data: { evidence: 'ran pnpm typecheck: exit 0' }, ...o })
  await expect(call(member, 'request_review', a)).rejects.toThrow(/`pnpm test` with exit code 0[\s\S]*pushed head/)
  await payload.update({ collection: 'runs', id: a.runId, data: { evidence: `on ${pr.headSha.slice(0, 7)}:\n- pnpm typecheck: exit 0\n- pnpm test: exit code 0, 640 passed` }, ...o })
  expect(await call(member, 'request_review', a)).toMatchObject({ stage: 'review' })
  expect((await reload(id)).stage).toBe('review')
})

/** A Ticket the Runner or poller already moved to Review (label and stage), with its MR head carrying `checks`. */
const inReview = async (checks: any[]) => {
  const s = await seed(checks)
  await payload.update({ collection: 'runs', id: s.a.runId, data: { status: 'succeeded' }, ...o })
  await payload.update({ collection: 'tickets', id: s.id, data: { stage: 'review' }, ...o })
  await fake.tickets(repo).addLabels(s.n, ['bauherr:stage:review'])
  return s
}

it('the autonomous and poller paths: startReviewIfReady on a red head sends the Ticket back to Build, no Review Run', async () => {
  const { id } = await inReview(red)
  const jobs = await import('../src/jobs')
  expect(await jobs.startReviewIfReady(payload, await reload(id))).toBeNull()
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewRounds: 0, waitingFor: null })
  expect(await runs(id, 'review')).toHaveLength(0)
  expect((await runs(id, 'build')).some((r) => ['awaiting_session', 'queued', 'running'].includes(r.status))).toBe(true)
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('e2e-fake (1)')
})

it('startReviewIfReady on a pending head parks the Ticket in Build waiting for checks; green later starts the review', async () => {
  const { id, pr } = await inReview(running)
  const jobs = await import('../src/jobs')
  expect(await jobs.startReviewIfReady(payload, await reload(id))).toBeNull()
  expect(await reload(id)).toMatchObject({ stage: 'build', waitingFor: 'checks' })
  expect(await runs(id, 'review')).toHaveLength(0)
  fake.setChecks(repo, pr.headSha, green)
  expect(await actions.watchChecks(payload)).toBe(1)
  expect(await reload(id)).toMatchObject({ stage: 'review', waitingFor: null })
  expect(await runs(id, 'review')).toHaveLength(1)
})

it('a green head, and a review that is already running, are not touched', async () => {
  const { id } = await inReview(green)
  const jobs = await import('../src/jobs')
  expect((await jobs.startReviewIfReady(payload, await reload(id)))?.run).toBeTruthy()
  expect(await reload(id)).toMatchObject({ stage: 'review' })
  // checks turn red while the review runs: the live review stays, the next call does not park the Ticket
  const live = await inReview(green)
  await jobs.startReviewIfReady(payload, await reload(live.id))
  fake.setChecks(repo, live.pr.headSha, red)
  expect((await jobs.startReviewIfReady(payload, await reload(live.id)))?.created).toBe(false)
  expect(await reload(live.id)).toMatchObject({ stage: 'review' })
})

it('pullWaiting for Review: a Ticket released from a full Review column with a red head goes back to Build', async () => {
  const { id } = await seed(red)
  await payload.update({ collection: 'tickets', id, data: { waitingFor: 'review' }, ...o })
  const wip = await import('../src/lib/wip')
  await wip.pullWaiting(payload)
  expect(await reload(id)).toMatchObject({ stage: 'build', waitingFor: null })
  expect(await runs(id, 'review')).toHaveLength(0)
})
