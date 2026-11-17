import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { sql } from '@payloadcms/db-postgres'
import { needsOf } from '../src/lib/needs-you'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let member: Doc
let call: (name: string, input?: unknown) => Promise<any>
let release: typeof import('../src/lib/release')
let actions: typeof import('../src/lib/actions')
let stageJobs: typeof import('../src/lib/stage-jobs')
let liveness: typeof import('../src/lib/liveness')
const o = { overrideAccess: true } as const
const repo = 'acme/walk'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/release-jobs-pack', import.meta.url))
  testDb = await createTestDb('release_jobs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  actions = await import('../src/lib/actions')
  stageJobs = await import('../src/lib/stage-jobs')
  liveness = await import('../src/lib/liveness')
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input = {}) => callTool({ payload, user: member, actor: { kind: 'human' } }, name, input)
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'cancelled' WHERE "status" IN ('awaiting_session', 'running', 'queued')`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "state" = 'closed' WHERE "state" = 'open'`)
})

const get = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Doc
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'release' } }] }, sort: 'id', depth: 0, pagination: false, ...o })).docs as Doc[]

const released = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, branch)
  const pr = await fake.forge.openPullRequest(repo, { title, head: branch, base: 'main' })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', kind: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  const sha = fake.merge(repo, pr.number)
  await release.watchRelease(payload)
  return { id: t.id as number, sha, n: String(issue.number) }
}
const onStaging = async (title: string) => {
  const r = await released(title)
  fake.setChecks(repo, r.sha, green)
  await release.watchRelease(payload)
  return r
}
const finishWalk = async (id: number, outcome: string) => {
  const claimed = await call('claim_next', { roles: ['ax'] })
  expect(claimed.run).toMatchObject({ ticket: id, job: 'staging-walk' })
  await call('finish_run', { runId: claimed.run.id, leaseToken: claimed.leaseToken, status: 'succeeded', outcome, comment: `walk ${outcome}` })
  return claimed
}

it('the staging walk starts only once the Ticket is on staging, with the staging URL and merge commit in its claim', async () => {
  const { id, sha } = await released('walk')
  expect(await get(id)).toMatchObject({ stage: 'release', releaseState: 'waiting' })
  expect(await stageJobs.startReadyJobs(payload, { id })).toBe(false)
  expect(await runsOf(id)).toHaveLength(0)
  fake.setChecks(repo, sha, green)
  await release.watchRelease(payload)
  expect(await get(id)).toMatchObject({ releaseState: 'on_staging' })
  expect((await runsOf(id)).map((r) => [r.job, r.kind, r.role, r.status])).toEqual([['staging-walk', 'agent', 'ax', 'awaiting_session']])
  const claimed = await call('claim_next', { roles: ['ax'] })
  expect(claimed).toMatchObject({ run: { job: 'staging-walk' }, agent: { job: 'staging-walk', outcomes: ['pass', 'findings'] }, staging: { url: 'https://staging.example', sha } })
})

it('acceptance is refused and not offered while the walk is open, and offered after it passed', async () => {
  const { id } = await onStaging('accept')
  expect(await stageJobs.jobsOpen(payload, await get(id))).toBe(true)
  await expect(actions.acceptStaging(payload, member, { ticket: id })).rejects.toThrow('still running')
  const row = { stage: 'release', labels: [], releaseState: 'on_staging' }
  expect(needsOf(await wf(), { ...row, jobsOpen: true }, null, false, ['staging'])).not.toBe('Accept on staging')
  await finishWalk(id, 'pass')
  expect(await stageJobs.jobsOpen(payload, await get(id))).toBe(false)
  expect(needsOf(await wf(), { ...row, jobsOpen: false }, null, false, ['staging'])).toBe('Accept on staging')
  expect(await get(id)).toMatchObject({ stage: 'release', releaseState: 'on_staging' })
})

it('findings send the Ticket to Build: release state, production state and the approval label are reset', async () => {
  const { id, n } = await onStaging('findings')
  await payload.update({ collection: 'tickets', id, data: { productionState: 'awaiting_approval' }, ...o })
  await fake.tickets(repo).addLabels(n, [release.APPROVED_PRODUCTION])
  await finishWalk(id, 'findings')
  expect(await get(id)).toMatchObject({ stage: 'build', releaseState: null, productionState: null })
  expect((await fake.tickets(repo).get(n)).labels).not.toContain(release.APPROVED_PRODUCTION)
  expect((await runsOf(id)).map((r) => r.status)).toEqual(['succeeded'])
})

it('with the staging gate off the Ticket waits for the walk, then passes staging', async () => {
  const { id } = await onStaging('auto')
  await release.watchRelease(payload)
  expect(await get(id)).toMatchObject({ stage: 'release', releaseState: 'on_staging' })
  await finishWalk(id, 'pass')
  await release.watchRelease(payload)
  expect(await get(id)).toMatchObject({ stage: 'done' })
})

it('request changes during the walk cancels the walk Run', async () => {
  const { id } = await onStaging('changes')
  await actions.requestChanges(payload, member, { ticket: id, note: 'fix it' })
  expect(await get(id)).toMatchObject({ stage: 'build', releaseState: null })
  expect((await runsOf(id)).map((r) => r.status)).toEqual(['cancelled'])
})

it('a failed walk Run climbs the ladder: a strong successor walk starts', async () => {
  const { id } = await onStaging('failed')
  const [walk] = await runsOf(id)
  await payload.update({ collection: 'runs', id: walk!.id, data: { status: 'failed', error: 'boom' }, ...o })
  expect((await liveness.deadTickets(payload, ws)).filter((d) => d.ticket.id === id).map((d) => d.cause)).toEqual(['run-failed'])
  await liveness.sweepLiveness(payload)
  const after = await runsOf(id)
  expect(after).toHaveLength(2)
  expect(after[1]).toMatchObject({ job: 'staging-walk', status: 'awaiting_session', escalation: { step: 2 } })
})

it('a walk Run attaches proof on the merge commit', async () => {
  const { id, sha } = await onStaging('proof')
  const claimed = await call('claim_next', { roles: ['ax'] })
  const base = { runId: claimed.run.id, leaseToken: claimed.leaseToken }
  const out = await call('attach_artifact', { ...base, kind: 'transcript', title: 'Walked the flow', text: 'GET /health 200' })
  expect(out.ok).toBe(true)
  expect((await payload.find({ collection: 'artifacts', where: { ticket: { equals: id } }, depth: 0, ...o })).docs).toMatchObject([{ sha, run: claimed.run.id }])
})

const wf = async () => (await import('../src/lib/factory')).workflowFor(ws)
