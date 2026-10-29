import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let gw: pg.Client
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  for (const d of ['bauherr_test_reconcile', 'bauherr_test_gateway']) {
    await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${d}`)
  }
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_reconcile')
  process.env.GATEWAY_DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_gateway')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  gw = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
  await gw.connect()
  await gw.query(`CREATE TABLE request_logs (id serial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), cost numeric,
    input_tokens int, output_tokens int, total_tokens int, gen_ai_request_model text, agentgateway_user text, attributes_json jsonb)`)
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await gw?.end()
  await payload?.destroy()
})

const seedRun = async (slug: string, costEstimateUsd: number) => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id
  const ticket = await payload.create({ collection: 'tickets', data: { title: slug, externalId: slug, product, workspace, number: 1 }, ...o })
  return payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'plan', workspace, costEstimateUsd }, ...o })
}

const logCall = (run: number | string, cost: number) =>
  gw.query(`INSERT INTO request_logs (cost, input_tokens, output_tokens, total_tokens, attributes_json) VALUES ($1, 10, 5, 15, $2)`, [
    cost,
    JSON.stringify({ run: String(run) }),
  ])

const reload = async (id: number | string) => payload.findByID({ collection: 'runs', id, ...o })

it('within 10 % of the gateway cost is matched; gateway cost and tokens are written', async () => {
  const { reconcileRun } = await import('../src/lib/reconcile')
  const run = await seedRun('m', 0.095)
  await logCall(run.id, 0.06)
  await logCall(run.id, 0.04)
  expect(await reconcileRun(payload, run.id, 1)).toBe('matched')
  expect(await reload(run.id)).toMatchObject({
    gatewayCostUsd: 0.1,
    gatewayTokensIn: 20,
    gatewayTokensOut: 10,
    gatewayTokensTotal: 30,
    costSource: 'gateway',
    reconcileStatus: 'matched',
    costUsd: 0.1,
  })
})

it('a larger delta is a mismatch, gateway cost still wins', async () => {
  const { reconcileRun } = await import('../src/lib/reconcile')
  const run = await seedRun('x', 0.01)
  await logCall(run.id, 0.1)
  expect(await reconcileRun(payload, run.id, 1)).toBe('mismatch')
  expect(await reload(run.id)).toMatchObject({ gatewayCostUsd: 0.1, costSource: 'gateway', reconcileStatus: 'mismatch', costUsd: 0.1 })
})

it('no rows: attempt 1 queues a retry 10 min out, attempt 2 settles on unavailable and keeps the estimate', async () => {
  const { reconcileRun } = await import('../src/lib/reconcile')
  const run = await seedRun('u', 0.02)
  expect(await reconcileRun(payload, run.id, 1)).toBe('pending')
  const jobs = await payload.find({ collection: 'payload-jobs' as never, where: { taskSlug: { equals: 'reconcile-costs' } } as never, limit: 100, ...o })
  const retry = jobs.docs.find((j) => (j as { input?: { runId?: number; attempt?: number } }).input?.runId === run.id) as
    | { input: { attempt: number }; waitUntil: string; queue: string }
    | undefined
  expect(retry).toMatchObject({ input: { attempt: 2 }, queue: 'poll' })
  expect(new Date(retry!.waitUntil).getTime() - Date.now()).toBeGreaterThan(9 * 60_000)
  expect((await reload(run.id)).reconcileStatus).toBe('pending')

  expect(await reconcileRun(payload, run.id, 2)).toBe('unavailable')
  expect(await reload(run.id)).toMatchObject({ reconcileStatus: 'unavailable', costSource: 'sdk-estimate', costUsd: 0.02 })
})

it('prune-request-logs deletes only rows older than the retention window', async () => {
  const { pruneRequestLogs } = await import('../src/lib/reconcile')
  await gw.query(`DELETE FROM request_logs`)
  await gw.query(`INSERT INTO request_logs (started_at) VALUES (now() - interval '200 days'), (now() - interval '181 days'), (now() - interval '179 days'), (now())`)
  expect(await pruneRequestLogs()).toBe(2)
  expect((await gw.query(`SELECT count(*)::int AS n FROM request_logs`)).rows[0].n).toBe(2)
  expect(await pruneRequestLogs(1)).toBe(1)
})
