import { sql } from '@payloadcms/db-postgres'
import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DEFAULT } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let testDb: TestDb
let gwDb: TestDb
let gw: pg.Client
let ws: number
let product: number
let owner: Doc
let cost: typeof import('../src/lib/cost')
let view: typeof import('../src/app/(app)/lib/cost')
const o = { overrideAccess: true } as const
let n = 0

beforeAll(async () => {
  testDb = await createTestDb('cost')
  gwDb = await createTestDb('cost_gateway')
  process.env.DATABASE_URL = testDb.url
  process.env.GATEWAY_DATABASE_URL = gwDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  gw = new pg.Client({ connectionString: gwDb.url })
  await gw.connect()
  await gw.query(`CREATE TABLE request_logs (id serial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), cost numeric,
    input_tokens int, output_tokens int, total_tokens int, gen_ai_request_model text, agentgateway_user text, attributes_json jsonb)`)
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  cost = await import('../src/lib/cost')
  view = await import('../src/app/(app)/lib/cost')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  owner = await payload.create({ collection: 'bauherren', data: { email: 'c@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await gw?.end()
  await payload?.destroy()
  await testDb?.drop(payload)
  await gwDb?.drop()
})

const db = () => payload.db.drizzle
const entries = async (run: number) => (await db().execute(sql`SELECT * FROM usage_entries WHERE run_id = ${run} ORDER BY model, source`)).rows as Doc[]
const ticketOf = async () => (await payload.create({ collection: 'tickets', data: { title: `t${++n}`, externalId: `c${n}`, number: n, product, workspace: ws }, ...o })).id as number
const runOf = async (data: Doc = {}) => (await payload.create({ collection: 'runs', data: { ticket: await ticketOf(), stage: 'build', workspace: ws, ...data }, ...o })).id as number
const sessionOf = async (label: string, extra: Doc = {}) =>
  (await payload.create({ collection: 'agent_sessions', data: { publicId: `ses_${label}`, workspace: ws, owner: owner.id, role: 'engineer', label, clientKey: label, connectedAt: new Date().toISOString(), ...extra } as never, ...o })) as Doc
const log = (run: number, model: string | null, c: number, i = 10, out = 5) =>
  gw.query(`INSERT INTO request_logs (cost, input_tokens, output_tokens, total_tokens, gen_ai_request_model, attributes_json) VALUES ($1, $2, $3, $4, $5, $6)`, [c, i, out, i + out, model, JSON.stringify({ run: String(run) })])

it('reconciliation writes one gateway row per model and a second reconcile never double counts', async () => {
  const { reconcileRun } = await import('../src/lib/reconcile')
  const run = await runOf({ role: 'reviewer', costEstimateUsd: 0.1 })
  await log(run, 'ws-acme/anthropic/claude-opus-5-5', 0.06)
  await log(run, 'ws-acme/anthropic/claude-opus-5-5', 0.04)
  await log(run, 'ws-acme/anthropic/claude-haiku-5-5', 0.01)
  await reconcileRun(payload, run, 1)
  await reconcileRun(payload, run, 1)
  const rows = await entries(run)
  expect(rows.map((r) => [r.model, r.source, r.provider, Number(r.tokens_in), Number(r.cost_usd), r.role, r.stage])).toEqual([
    ['claude-haiku-5-5', 'gateway', 'anthropic', 10, 0.01, 'reviewer', 'build'],
    ['claude-opus-5-5', 'gateway', 'anthropic', 20, 0.1, 'reviewer', 'build'],
  ])
})

it('a session report stores the maximum of the cumulative reports, prices tokens, and keeps the Run fields in sync', async () => {
  const s = await sessionOf('a')
  const run = await runOf({ session: s.id, role: 'engineer', model: 'claude-opus-5-5' })
  await cost.reportRunUsage(payload, run, s, { tokensIn: 1000, tokensOut: 200, cacheRead: 5000, cacheWrite: 100 })
  await cost.reportRunUsage(payload, run, s, { tokensIn: 3000, tokensOut: 600, cacheRead: 9000, cacheWrite: 100 })
  await cost.reportRunUsage(payload, run, s, { tokensIn: 3000, tokensOut: 600, cacheRead: 9000, cacheWrite: 100 })
  await cost.reportRunUsage(payload, run, s, { tokensIn: 1, tokensOut: 1 })
  const [row] = await entries(run)
  expect(row).toMatchObject({ source: 'session-reported', model: 'claude-opus-5-5', role: 'engineer' })
  expect([Number(row!.tokens_in), Number(row!.tokens_out), Number(row!.cache_read)]).toEqual([3000, 600, 9000])
  expect(Number(row!.cost_usd)).toBeCloseTo((3000 * 5 + 600 * 25 + 9000 * 0.5 + 100 * 6.25) / 1e6, 6)
  const r = await payload.findByID({ collection: 'runs', id: run, ...o })
  expect(r).toMatchObject({ tokensIn: 3000, tokensOut: 600, tokensCache: 9100, costSource: 'session-reported' })
  await expect(cost.reportRunUsage(payload, run, s, { tokensIn: -1 })).rejects.toThrow(/non-negative/)
  await payload.create({ collection: 'usage_cursors', data: { session: s.id, claudeSession: 'cc', totals: {}, workspace: ws } as never, ...o })
  expect((await cost.reportRunUsage(payload, run, s, { tokensIn: 1 })).stored).toBe(false)
})

it('the hook stores deltas on the Run the session holds; a repeated report adds nothing; history before connect is the baseline', async () => {
  const s = await sessionOf('h', { agentKey: undefined })
  const run = await runOf({ session: s.id, status: 'running', startedAt: new Date().toISOString() })
  const who = { owner: owner.id, keyId: 0 }
  const body = (opus: number[]) => ({ claudeSession: 'cc-1', clientKey: 'h', firstAt: new Date().toISOString(), models: { 'claude-opus-5-5': opus as [number, number, number, number] } })
  expect((await cost.reportDelta(payload, who, body([100, 50, 1000, 10]))).delta).toMatchObject({ tokensIn: 100, tokensOut: 50 })
  expect((await cost.reportDelta(payload, who, body([100, 50, 1000, 10]))).delta).toMatchObject({ tokensIn: 0, tokensOut: 0 })
  expect((await cost.reportDelta(payload, who, body([160, 90, 1500, 10]))).run).toBe(run)
  const [row] = await entries(run)
  expect([Number(row!.tokens_in), Number(row!.tokens_out), Number(row!.cache_read)]).toEqual([160, 90, 1500])
  expect(Number(row!.cost_usd)).toBeGreaterThan(0)
  await db().execute(sql`UPDATE runs SET status = 'succeeded' WHERE id = ${run}`)
  await cost.reportDelta(payload, who, body([170, 90, 1500, 10]))
  const idle = (await db().execute(sql`SELECT * FROM usage_entries WHERE session_id = ${s.id} AND run_id IS NULL`)).rows as Doc[]
  expect(idle.map((r) => Number(r.tokens_in))).toEqual([10])
  const old = await sessionOf('old')
  const first = await cost.reportDelta(payload, who, { claudeSession: 'cc-2', clientKey: 'old', firstAt: new Date(Date.now() - 86400e3).toISOString(), models: { 'claude-opus-5-5': [9999, 1, 0, 0] } })
  expect(first.delta.tokensIn).toBe(0)
  expect((await db().execute(sql`SELECT 1 FROM usage_entries WHERE session_id = ${old.id}`)).rows).toHaveLength(0)
  await expect(cost.reportDelta(payload, who, { claudeSession: 'x', clientKey: 'nope', models: {} })).rejects.toThrow(/no connected session/)
})

it('aggregates by model, role, session, stage and Ticket; a gateway Run drops its session-reported rows; coverage and cost per finished Ticket are shown', async () => {
  const wf = DEFAULT()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'agg', slug: 'agg' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'agg', slug: 'agg', workspace: ws }, ...o })).id as number
  const s = await sessionOf('agg')
  const t = await ticketOf()
  const mk = (data: Doc) => payload.create({ collection: 'runs', data: { ticket: t, workspace: ws, finishedAt: new Date().toISOString(), ...data }, ...o }).then((r) => r.id as number)
  const reviewRun = await mk({ stage: 'review', status: 'succeeded', mode: 'autonomous', executor: 'runner', role: 'reviewer' })
  const buildRun = await mk({ stage: 'build', status: 'succeeded', mode: 'session', session: s.id, role: 'engineer' })
  const bare = await mk({ stage: 'plan', status: 'failed', mode: 'autonomous', executor: 'runner' })
  const put = (run: number, stage: string, role: string, model: string, source: string, c: number | null, session: number | null = null) =>
    db().execute(sql`INSERT INTO usage_entries (workspace_id, run_id, ticket_id, session_id, stage, role, model, tokens_in, tokens_out, cost_usd, source, at) VALUES (${ws}, ${run}, ${t}, ${session}, ${stage}, ${role}, ${model}, 100, 50, ${c}, ${source}::enum_usage_entries_source, now())`)
  await put(reviewRun, 'review', 'reviewer', 'claude-opus-5-5', 'gateway', 2)
  await put(buildRun, 'build', 'engineer', 'claude-sonnet-5-5', 'session-reported', 1, s.id)
  await put(buildRun, 'build', 'engineer', 'claude-opus-5-5', 'session-reported', null, s.id)
  await put(reviewRun, 'review', 'reviewer', 'claude-opus-5-5', 'session-reported', 50, s.id)
  await db().execute(sql`INSERT INTO ticket_events (workspace_id, ticket_id, at, stage, phase, cause) VALUES (${ws}, ${t}, now(), 'done', 'closed', 'test')`)
  const thread = await payload.create({ collection: 'chat_threads', data: { owner: owner.id, workspace: ws } as never, ...o })
  await payload.create({ collection: 'chat_messages', data: { thread: thread.id, workspace: ws, messageId: 'm1', answer: { model: 'claude-haiku-5-5', tokensIn: 10, tokensOut: 5, costUsd: 0.5 } } as never, ...o })

  const c = await view.loadCost(payload, wf, ws, { days: 7, product: null })
  const by = (ls: { key: string; costUsd: number }[]) => Object.fromEntries(ls.map((l) => [l.key, l.costUsd]))
  expect(by(c.byModel)).toMatchObject({ 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 1, 'claude-haiku-5-5': 0.5 })
  expect(by(c.byRole)).toMatchObject({ reviewer: 2, engineer: 1, chat: 0.5 })
  expect(c.byRole.find((l) => l.key === 'chat')!.label).toBe('Chat')
  expect(by(c.bySession)).toMatchObject({ agg: 1, Runner: 2, Chat: 0.5 })
  expect(by(c.byStage)).toMatchObject({ review: 2, build: 1 })
  expect(c.byModel.find((l) => l.key === 'claude-opus-5-5')!.unpriced).toBe(1)
  expect(c.totalUsd).toBeCloseTo(3.5)
  expect(c.perTicket).toMatchObject({ n: 1, median: 3, p85: 3 })
  expect(c.byStage.find((l) => l.key === 'review')!.perTicket).toMatchObject({ n: 1, median: 2 })
  expect(c.doneTickets).toEqual({ total: 1, priced: 1 })
  expect(c.coverage).toEqual([
    { label: 'Runner and CI Runs (gateway)', runs: 2, covered: 1 },
    { label: 'Session Runs (gateway or reported)', runs: 1, covered: 1 },
  ])
  expect(bare).toBeGreaterThan(0)
  expect((await view.loadCost(payload, wf, ws, { days: 7, product })).byModel.find((l) => l.key === 'claude-haiku-5-5')).toBeUndefined()

  const team = await view.loadTeamCost(payload, ws)
  expect(team.sessions.ses_agg).toEqual({ today: 1, d30: 1 })
  expect(team.roles.reviewer!.d30).toBe(2)
  expect(view.quantile([1, 2, 3, 4], 0.85)).toBeCloseTo(3.55)
})
