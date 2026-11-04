import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { FakeBackend } from '@bauherr/adapters'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let member: Record<string, any>
let outsider: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let fake: FakeBackend
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('leaserenewal')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  outsider = await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** A Ticket (the fake forge only knows #1) with a claimed session build Run. */
const claimed = async () => {
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: `r-${++n}`, number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  return { run, leaseToken }
}
const row = async (id: number | string) => (await payload.findByID({ collection: 'runs', id, ...o })) as Record<string, any>
const silent = (id: number | string, minutes: number) => raw(sql`UPDATE "runs" SET "heartbeat_at" = now() - make_interval(mins => ${minutes}) WHERE "id" = ${id}`)
const raw = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)
const inMinutes = (m: number) => Date.now() + m * 60_000

it('report_step renews the lease: no abandon at 31 minutes after the last call', async () => {
  const { run, leaseToken } = await claimed()
  await silent(run.id, 25)
  await call(member, 'report_step', { runId: run.id, leaseToken, summary: 's' })
  await jobs.expireStaleSessions(payload, inMinutes(6))
  expect((await row(run.id)).status).toBe('running')
  await jobs.expireStaleSessions(payload, inMinutes(31))
  expect((await row(run.id)).status).toBe('abandoned')
})

it('a moved branch head renews the lease before it expires; an unmoved one is abandoned', async () => {
  const { run } = await claimed()
  const branch = `bauherr/1-${run.id}`
  await fake.forge.createBranch('acme/web', branch)
  await silent(run.id, 25)
  await jobs.expireStaleSessions(payload)
  const first = await row(run.id)
  expect(first.status).toBe('running')
  expect(first.lastSeenSha).toBeTruthy()
  expect(Date.now() - new Date(first.heartbeatAt).getTime()).toBeLessThan(60_000)
  await silent(run.id, 25)
  await jobs.expireStaleSessions(payload)
  expect(Date.now() - new Date((await row(run.id)).heartbeatAt).getTime()).toBeGreaterThan(24 * 60_000)
  fake.commit('acme/web', branch, 'f.txt', 'x')
  await jobs.expireStaleSessions(payload)
  const moved = await row(run.id)
  expect(moved.lastSeenSha).not.toBe(first.lastSeenSha)
  expect(Date.now() - new Date(moved.heartbeatAt).getTime()).toBeLessThan(60_000)
  await silent(run.id, 31)
  await jobs.expireStaleSessions(payload)
  expect((await row(run.id)).status).toBe('abandoned')
})

it('an expired lease is not revived by a push, and a late call gets lease lost', async () => {
  const { run, leaseToken } = await claimed()
  const branch = `bauherr/1-${run.id}`
  await fake.forge.createBranch('acme/web', branch)
  await silent(run.id, 35)
  const before = (await row(run.id)).heartbeatAt
  await expect(call(member, 'heartbeat', { runId: run.id, leaseToken })).rejects.toThrow('lease lost')
  await jobs.expireStaleSessions(payload)
  expect((await row(run.id)).status).toBe('abandoned')
  expect((await row(run.id)).heartbeatAt).toBe(before)
})

it('a forge error neither renews nor abandons a Run that is still inside its lease', async () => {
  const { run } = await claimed()
  await silent(run.id, 25)
  const before = (await row(run.id)).heartbeatAt
  const forge = fake.forge as any
  const real = forge.getBranch
  forge.getBranch = async () => {
    throw new Error('rate limited')
  }
  try {
    await jobs.expireStaleSessions(payload)
  } finally {
    forge.getBranch = real
  }
  const after = await row(run.id)
  expect(after.status).toBe('running')
  expect(after.heartbeatAt).toBe(before)
})

it('lease-checked responses carry leaseExpiresAt', async () => {
  const { run, leaseToken } = await claimed()
  const beat = new Date((await row(run.id)).heartbeatAt).getTime()
  for (const [name, extra] of [['heartbeat', {}], ['report_step', { summary: 's' }], ['attach_evidence', { markdown: 'm' }], ['run_checks', {}]] as const) {
    const r = await call(member, name, { runId: run.id, leaseToken, ...extra })
    expect(new Date(r.leaseExpiresAt).getTime()).toBeGreaterThanOrEqual(beat + jobs.SESSION_TIMEOUT_MS)
  }
})

it('the abandon error names the last sign of life and the last call', async () => {
  const { run, leaseToken } = await claimed()
  await call(member, 'attach_evidence', { runId: run.id, leaseToken, markdown: 'm' })
  const beat = new Date((await row(run.id)).heartbeatAt).toISOString()
  await jobs.expireStaleSessions(payload, inMinutes(31))
  expect((await row(run.id)).error).toBe(`session lease expired (last sign of life ${beat}, last call attach_evidence)`)
})

it('a wrong token never renews', async () => {
  const { run, leaseToken } = await claimed()
  await silent(run.id, 10)
  const before = (await row(run.id)).heartbeatAt
  for (const name of ['heartbeat', 'report_step', 'attach_evidence', 'run_checks']) {
    await expect(call(member, name, { runId: run.id, leaseToken: 'x'.repeat(43), summary: 's', markdown: 'm' })).rejects.toThrow('leased by another session')
  }
  expect((await row(run.id)).heartbeatAt).toBe(before)
  await expect(call(member, 'heartbeat', { runId: run.id, leaseToken })).resolves.toMatchObject({ ok: true })
})
