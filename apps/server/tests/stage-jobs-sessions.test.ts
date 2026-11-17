import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>

/** Sessions claim the parallel Job Runs of the `audit` stage of fixtures/jobs-pack by role. */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Doc
let call: (name: string, input?: unknown) => Promise<any>
let advance: typeof import('../src/lib/advance').advance
const o = { overrideAccess: true } as const
const repo = 'acme/sessions'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/jobs-pack', import.meta.url))
  testDb = await createTestDb('stage_jobs_sessions')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ;({ advance } = await import('../src/lib/advance'))
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, pathSets: { ui: ['src/app/**'] } }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  user = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input = {}) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'cancelled' WHERE "status" IN ('awaiting_session', 'running')`)
})

const audited = async () => {
  const issue = await fake.tickets(repo).create({ title: 't', labels: ['bauherr:stage:build'] })
  const id = (await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })).id as number
  await advance(payload, null, (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Doc, 'done', { by: 'factory' })
  return id
}
const session = async (role: string) => (await call('connect', { role, session: `${role}-1` })).sessionId as string

it('two sessions claim the two parallel Job Runs of one Ticket, each with the skill and outcomes of its Job', async () => {
  const id = await audited()
  const [security, ux, test, engineer] = await Promise.all(['security', 'ux', 'test', 'engineer'].map(session))
  expect((await call('list_frontier')).filter((t: Doc) => t.ticket === id)).toMatchObject([{ stage: 'audit', claimable: true }])

  const a = await call('next_work', { sessionId: security })
  expect(a.work).toMatchObject({ run: { job: 'security', role: 'security' }, skill: 'mr-security-review', outcomes: ['pass', 'findings'], agent: { stage: 'audit', job: 'security', role: { id: 'security' } } })
  const b = await call('next_work', { sessionId: ux })
  expect(b.work).toMatchObject({ run: { job: 'ux', role: 'ux' }, skill: 'ux-review', agent: { job: 'ux' } })
  expect((await call('next_work', { sessionId: engineer })).work).toBeNull()

  const c = await call('next_work', { sessionId: test })
  expect(c.work).toMatchObject({ run: { job: 'test' }, skill: 'test-review' })
  expect((await call('list_frontier')).filter((t: Doc) => t.ticket === id)).toMatchObject([{ claimable: false }])

  await call('finish_run', { runId: a.work.run.id, leaseToken: a.work.leaseToken, status: 'succeeded', outcome: 'pass', sessionId: security })
  await call('finish_run', { runId: b.work.run.id, leaseToken: b.work.leaseToken, status: 'succeeded', outcome: 'pass', sessionId: ux })
  await call('finish_run', { runId: c.work.run.id, leaseToken: c.work.leaseToken, status: 'succeeded', outcome: 'pass', sessionId: test })
  const reviewer = await session('reviewer')
  expect((await call('next_work', { sessionId: reviewer })).work).toMatchObject({ run: { job: 'verify', role: 'reviewer' }, skill: 'review', agent: { job: 'verify' } })
})

it('claim_next without a session returns the Job Runs of one Ticket one after the other, and a role filter skips foreign roles', async () => {
  const id = await audited()
  const first = await call('claim_next', { roles: ['ux'] })
  expect(first.run).toMatchObject({ ticket: id, job: 'ux' })
  const second = await call('claim_next', { roles: ['security'] })
  expect(second.run).toMatchObject({ ticket: id, job: 'security' })
  expect(await call('claim_next', { roles: ['engineer'] })).toBeNull()
})

it('claim_run answers with the first claimable Job Run of the Ticket', async () => {
  const id = await audited()
  const runs = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { status: { equals: 'awaiting_session' } }] }, sort: 'id', depth: 0, ...o })).docs as Doc[]
  await expect(call('claim_run', { runId: runs[1]!.id })).rejects.toThrow(`take Run ${runs[0]!.id}`)
  expect((await call('claim_run', { runId: runs[0]!.id })).run.id).toBe(runs[0]!.id)
})

it('finish_run refuses candidate findings on a Job of an agent stage and on a stage-own Run', async () => {
  await audited()
  const security = await session('security')
  const a = await call('next_work', { sessionId: security })
  const finding = { severity: 'medium', class: 'rule', file: 'a.ts', line: 1, msg: 'm', scenario: 's' }
  await expect(call('finish_run', { runId: a.work.run.id, leaseToken: a.work.leaseToken, status: 'succeeded', outcome: 'pass', findings: [finding], sessionId: security })).rejects.toThrow('only for the Jobs of a review stage')
  await expect(call('finish_run', { runId: a.work.run.id, leaseToken: a.work.leaseToken, status: 'succeeded', outcome: 'pass', open: [], sessionId: security })).rejects.toThrow('only for the Jobs of a review stage')
  expect((await payload.findByID({ collection: 'runs', id: a.work.run.id, depth: 0, ...o })).status).toBe('running')
})
