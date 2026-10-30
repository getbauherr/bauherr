import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let member: Record<string, any>
let outsider: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_lease WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_lease')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_lease')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user }, name, input)
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
})

/** A Ticket (the fake forge only knows #1) with an awaiting_session build Run. */
const seed = async () => {
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: `l-${++n}`, number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
  return { ticket, run }
}
const status = async (id: number | string) => (await payload.findByID({ collection: 'runs', id, ...o })).status
const successorOf = async (id: number | string) => (await payload.find({ collection: 'runs', where: { previousRun: { equals: id } }, depth: 0, ...o })).docs[0]
const late = () => Date.now() + jobs.SESSION_TIMEOUT_MS + 60_000

it('claim returns a token; the same user with another token or none is refused', async () => {
  const { run } = await seed()
  const { leaseToken, run: claimed } = await call(member, 'claim_run', { runId: run.id })
  expect(leaseToken).toMatch(/^[\w-]{43}$/)
  expect(claimed.leaseHash).toBeUndefined()
  await expect(call(member, 'heartbeat', { runId: run.id, leaseToken })).resolves.toEqual({ ok: true })
  await expect(call(member, 'heartbeat', { runId: run.id, leaseToken: 'x'.repeat(43) })).rejects.toThrow(`run ${run.id} is leased by another session`)
  await expect(call(member, 'report_step', { runId: run.id, summary: 's' })).rejects.toThrow('leased by another session')
  await expect(call(member, 'release_run', { runId: run.id })).rejects.toThrow('leased by another session')
  await expect(call(member, 'report_step', { runId: run.id, leaseToken, summary: 's' })).resolves.toMatchObject({ seq: 1 })
})

it('a claim race has one winner', async () => {
  const { run } = await seed()
  const r = await Promise.allSettled([call(member, 'claim_run', { runId: run.id }), call(member, 'claim_run', { runId: run.id })])
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: { message: expect.stringContaining('claimed by someone else') } })
})

it('update_worklog needs the token of the live lease', async () => {
  const { ticket, run } = await seed()
  await expect(call(member, 'update_worklog', { ticket: ticket.id, markdown: 'free' })).resolves.toBeDefined()
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await expect(call(member, 'update_worklog', { ticket: ticket.id, markdown: 'x' })).rejects.toThrow('leased by another session')
  await expect(call(member, 'update_worklog', { ticket: ticket.id, markdown: 'x', leaseToken })).resolves.toBeDefined()
})

it('an expired lease abandons the Run and queues a successor; the late owner gets lease lost', async () => {
  const { ticket, run } = await seed()
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await jobs.expireStaleSessions(payload, late())
  expect(await status(run.id)).toBe('abandoned')
  expect(await successorOf(run.id)).toMatchObject({ status: 'awaiting_session', mode: 'session', stage: 'build', workspace: ws, ticket: ticket.id })
  await expect(call(member, 'heartbeat', { runId: run.id, leaseToken })).rejects.toThrow(`lease lost: run ${run.id} is abandoned`)
  await expect(call(member, 'finish_run', { runId: run.id, leaseToken, status: 'failed', reason: 'r' })).rejects.toThrow('lease lost')
})

it('two abandoned Runs in a row end needs_human without a successor', async () => {
  const { run } = await seed()
  await call(member, 'claim_run', { runId: run.id })
  await jobs.expireStaleSessions(payload, late())
  const second = await successorOf(run.id)
  await call(member, 'claim_run', { runId: second.id })
  await jobs.expireStaleSessions(payload, late())
  expect(await status(second.id)).toBe('needs_human')
  expect(await successorOf(second.id)).toBeUndefined()
})

it('release lock: a Workspace member abandons the Run, a non-member is refused', async () => {
  const { run } = await seed()
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await expect(actions.releaseLock(payload, outsider, { runId: run.id })).rejects.toBeInstanceOf(actions.NotInWorkspace)
  expect(await status(run.id)).toBe('running')
  await expect(actions.releaseLock(payload, member, { runId: run.id })).resolves.toEqual({ status: 'abandoned' })
  expect(await status(run.id)).toBe('abandoned')
  expect(await successorOf(run.id)).toMatchObject({ status: 'awaiting_session' })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ run: { equals: run.id } }, { kind: { equals: 'release-lock:build' } }, { actor: { equals: member.email } }] }, ...o })).toMatchObject({ totalDocs: 1 })
  await expect(call(member, 'heartbeat', { runId: run.id, leaseToken })).rejects.toThrow('lease lost')
  await expect(actions.releaseLock(payload, member, { runId: run.id })).rejects.toThrow('not a running session Run')
})

it('a human release never escalates to needs_human', async () => {
  const { run } = await seed()
  await call(member, 'claim_run', { runId: run.id })
  await jobs.expireStaleSessions(payload, late())
  const second = await successorOf(run.id)
  await call(member, 'claim_run', { runId: second.id })
  await actions.releaseLock(payload, member, { runId: second.id })
  expect(await status(second.id)).toBe('abandoned')
  expect(await successorOf(second.id)).toBeDefined()
})

it('list_frontier flags claimable and leased Tickets', async () => {
  const { ticket, run } = await seed()
  const flags = async () => (await call(member, 'list_frontier', {})).find((t: any) => t.ticket === ticket.id)
  expect(await flags()).toMatchObject({ claimable: true })
  expect(await flags()).not.toHaveProperty('leasedBy')
  await call(member, 'claim_run', { runId: run.id })
  const f = await flags()
  expect(f).toMatchObject({ claimable: false, leasedBy: 'm@x.io' })
  const beat = new Date((await payload.findByID({ collection: 'runs', id: run.id, ...o })).heartbeatAt).getTime()
  expect(new Date(f.leaseExpiresAt).getTime()).toBe(beat + jobs.SESSION_TIMEOUT_MS)
})
