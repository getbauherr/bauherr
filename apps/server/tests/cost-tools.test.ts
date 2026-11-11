import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let member: Record<string, any>
let run: number
let call: (name: string, input: unknown) => Promise<any>
let testDb: TestDb
const o = { overrideAccess: true } as const

beforeAll(async () => {
  testDb = await createTestDb('cost_tools')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input) => callTool({ payload, user: member, actor: { kind: 'human' } }, name, input)
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: 'c-1', number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  run = (await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws, model: 'claude-sonnet-5-5' }, ...o })).id as number
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const rows = async () => ((await (payload.db as any).drizzle.execute(sql`SELECT * FROM usage_entries WHERE run_id = ${run}`)).rows as Record<string, any>[])

it('heartbeat and finish_run accept cumulative usage; repeats and a bad value are safe', async () => {
  const { leaseToken } = await call('claim_run', { runId: run })
  await call('heartbeat', { runId: run, leaseToken, usage: { tokensIn: 1000, tokensOut: 100, costUsd: 0.2 } })
  await call('heartbeat', { runId: run, leaseToken, usage: { tokensIn: 1000, tokensOut: 100, costUsd: 0.2 } })
  await expect(call('heartbeat', { runId: run, leaseToken, usage: { tokensIn: 'many' } })).rejects.toThrow(/non-negative/)
  expect((await rows()).map((r) => [r.source, r.model, Number(r.tokens_in), Number(r.cost_usd)])).toEqual([['session-reported', 'claude-sonnet-5-5', 1000, 0.2]])
  await call('finish_run', { runId: run, leaseToken, status: 'failed', reason: 'x', usage: { tokensIn: 1500, tokensOut: 300, costUsd: 0.5 } })
  expect((await rows()).map((r) => [Number(r.tokens_in), Number(r.tokens_out), Number(r.cost_usd)])).toEqual([[1500, 300, 0.5]])
  expect(await payload.findByID({ collection: 'runs', id: run, ...o })).toMatchObject({ costSource: 'session-reported', costUsd: 0.5, tokensIn: 1500 })
})

it('connect tells the session to report usage', async () => {
  const out = await call('connect', { role: 'engineer', session: 'k1' })
  expect(out.usage).toMatch(/heartbeat and finish_run/)
})
