import pg from 'pg'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { attribute, providerOf, type Call, type Sess, type Span } from '../src/lib/session-usage'
import { createTestDb, type TestDb } from './helpers/test-db'

const T = (min: number) => Date.UTC(2026, 10, 12, 10, min)
const call = (min: number, session: string | null, extra: Partial<Call> = {}): Call => ({ at: T(min), workspace: 1, session, role: null, model: 'claude-sonnet-5-5', provider: 'subscription', tin: 10, tout: 5, cr: 0, cw: 0, cost: 0.01, ...extra })
const sess = (id: number, key: string, extra: Partial<Sess> = {}): Sess => ({ id, workspace: 1, clientKey: key, role: 'engineer', connectedAt: T(0), disconnectedAt: null, ...extra })
const span = (sessionId: number, runId: number, from: number, to: number): Span => ({ sessionId, runId, ticketId: null, stage: 'build', role: 'engineer', startedAt: T(from), lastAt: T(to) })

it('a call inside a span belongs to that Run, one between Runs to the session without a Run', () => {
  const hits = attribute([call(5, 'eng-1'), call(15, 'eng-1'), call(25, 'eng-1')], [sess(1, 'eng-1')], [span(1, 7, 1, 10), span(1, 8, 20, 30)])
  expect(hits.map((h) => [h.session?.id, h.span?.runId ?? null])).toEqual([[1, 7], [1, null], [1, 8]])
})

it('two sessions of one key do not mix', () => {
  const sessions = [sess(1, 'eng-1'), sess(2, 'rev-2', { role: 'reviewer' })]
  const spans = [span(1, 7, 0, 30), span(2, 9, 0, 30)]
  const hits = attribute([call(5, 'eng-1'), call(6, 'rev-2')], sessions, spans)
  expect(hits.map((h) => [h.session?.id, h.span?.runId])).toEqual([[1, 7], [2, 9]])
})

it('another Workspace never receives the call, whatever the header says', () => {
  const other = sess(5, 'eng-1', { workspace: 2 })
  const [h] = attribute([call(5, 'eng-1')], [other], [span(5, 99, 0, 30)])
  expect(h!.session).toBeNull()
  expect(h!.span).toBeNull()
})

it('a name shared by two people goes to the one holding a Run, else to the one connected then; no name or an unknown name is unattributed', () => {
  const a = sess(1, 'same', { connectedAt: T(0), disconnectedAt: T(8) })
  const b = sess(2, 'same', { connectedAt: T(9) })
  const hits = attribute([call(5, 'same'), call(12, 'same'), call(5, null), call(5, 'nobody')], [a, b], [span(1, 7, 1, 6)])
  expect(hits.map((h) => [h.session?.id ?? null, h.span?.runId ?? null])).toEqual([[1, 7], [2, null], [null, null], [null, null]])
})

it('providerOf names the Connection of a gateway model and the owner login "subscription"', () => {
  expect(providerOf('ws-acme/anthropic/claude-sonnet-5-5')).toBe('anthropic')
  expect(providerOf('claude-sonnet-5-5')).toBe('subscription')
  expect(providerOf('sub/claude-sonnet-5-5')).toBe('subscription')
  expect(providerOf(null)).toBe('subscription')
})

let payload: Payload
let testDb: TestDb
let gwDb: TestDb
let gw: pg.Client
const o = { overrideAccess: true } as const
const db = () => payload.db.drizzle

beforeAll(async () => {
  testDb = await createTestDb('session_usage')
  gwDb = await createTestDb('session_usage_gw')
  process.env.DATABASE_URL = testDb.url
  process.env.GATEWAY_DATABASE_URL = gwDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  gw = new pg.Client({ connectionString: gwDb.url })
  await gw.connect()
  await gw.query(`CREATE TABLE request_logs (id serial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), http_status int, cost numeric, input_tokens int, output_tokens int, cache_read_input_tokens int, cache_creation_input_tokens int, gen_ai_request_model text, agentgateway_user text, attributes_json jsonb)`)
  await gw.query(`CREATE TABLE _agentgateway_request_log_migrations (version bigint PRIMARY KEY)`)
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})
afterAll(async () => {
  await gw?.end()
  await payload?.destroy()
  await testDb?.drop(payload)
  await gwDb?.drop()
})
beforeEach(async () => {
  await gw.query('DELETE FROM request_logs')
  await db().execute(sql`DELETE FROM "usage_entries"`)
})

const log = (at: Date, o: { ws: string; session?: string; key?: string; tin?: number; cr?: number; cw?: number; tout?: number; cost?: number | null; model?: string; status?: number; run?: string; original?: string }) =>
  gw.query(
    `INSERT INTO request_logs (started_at, http_status, cost, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, gen_ai_request_model, agentgateway_user, attributes_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [at, o.status ?? 200, o.cost === undefined ? 0.5 : o.cost, o.tin ?? 100, o.tout ?? 20, o.cr ?? 0, o.cw ?? 0, o.model ?? 'claude-sonnet-5-5', `workspace-${o.ws}`, JSON.stringify({ ...(o.session && { session: o.session }), ...(o.run && { run: o.run }), 'agw.api_key.name': `workspace-${o.key ?? o.ws}-session`, 'agw.ai.original_model': o.original ?? 'claude-sonnet-5-5' })],
  )

const seed = async (slug: string) => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id
  const ticket = (await payload.create({ collection: 'tickets', data: { title: slug, externalId: slug, product, workspace, number: 1 }, ...o })).id
  const sessionId = ((await db().execute(sql`INSERT INTO "agent_sessions" ("workspace_id", "public_id", "owner_id", "role", "label", "client_key", "connected_at", "last_seen_at") VALUES (${workspace}, ${`ses_${slug}`}, (SELECT "id" FROM "bauherren" LIMIT 1), 'engineer', ${`eng-${slug}`}, ${`eng-${slug}`}, now() - interval '1 hour', now()) RETURNING "id"`)).rows[0] as { id: number }).id
  return { workspace, ticket, sessionId, slug }
}

it('reconcile attributes calls per session and Run, prices by cache split, is idempotent and ignores other traffic', async () => {
  const { reconcileSessions } = await import('../src/lib/session-usage')
  await payload.create({ collection: 'bauherren', data: { email: 'su@example.com', password: 'x'.repeat(12), role: 'admin' } as never, ...o }).catch(() => undefined)
  const a = await seed('sua')
  const b = await seed('sub')
  const now = Date.now()
  const run = (await payload.create({ collection: 'runs', data: { ticket: a.ticket, stage: 'build', workspace: a.workspace, mode: 'session', status: 'succeeded' }, ...o })).id
  await db().execute(sql`UPDATE "runs" SET "session_id" = ${a.sessionId}, "role" = 'engineer' WHERE "id" = ${run}`)
  await db().execute(sql`INSERT INTO "session_spans" ("workspace_id", "session_id", "run_id", "ticket_id", "started_at", "last_at") VALUES (${a.workspace}, ${a.sessionId}, ${run}, ${a.ticket}, ${new Date(now - 30 * 60_000).toISOString()}::timestamptz, ${new Date(now - 10 * 60_000).toISOString()}::timestamptz)`)
  const at = (minAgo: number) => new Date(now - minAgo * 60_000)
  await log(at(20), { ws: 'sua', session: 'eng-sua', tin: 450, cr: 300, cw: 50, tout: 20, cost: 0.0008775 })
  await log(at(15), { ws: 'sua', session: 'eng-sua', tin: 100, tout: 10, cost: 0.001 })
  await log(at(5), { ws: 'sua', session: 'eng-sua', tin: 100, tout: 10, cost: 0.002 })
  await log(at(4), { ws: 'sua', tin: 7, tout: 3, cost: 0.003 })
  await log(at(3), { ws: 'sub', session: 'eng-sua', tin: 1000, tout: 1000, cost: 9 })
  await log(at(3), { ws: 'sua', session: 'eng-sua', status: 401, tin: 0, tout: 0, cost: null })
  await log(at(3), { ws: 'sua', session: 'eng-sua', run: '5', tin: 5, tout: 5, cost: 4 })
  await log(at(3), { ws: 'nobody', session: 'eng-sua', tin: 5, tout: 5, cost: 4 })
  await log(at(2), { ws: 'sua', session: 'eng-sua', tin: 100, tout: 100, cost: null, model: 'unknown-model-x', original: 'ws-sua/anthropic/unknown-model-x' })

  const first = await reconcileSessions(payload, now)
  expect(first).toEqual({ calls: 6, runs: 1 })
  const rows = async () => (await db().execute(sql`SELECT "workspace_id", "run_id", "session_id", "ticket_id", "stage", "role", "model", "provider", "tokens_in"::float8 AS tin, "tokens_out"::float8 AS tout, "cache_read"::float8 AS cr, "cache_write"::float8 AS cw, "cost_usd"::float8 AS cost FROM "usage_entries" WHERE "source" = 'gateway' ORDER BY "workspace_id", "run_id" NULLS LAST, "model"`)).rows as Record<string, any>[]
  const out = await rows()
  const inRun = out.find((r) => r.run_id === run)!
  expect(inRun).toMatchObject({ workspace_id: a.workspace, session_id: a.sessionId, ticket_id: a.ticket, stage: 'build', role: 'engineer', model: 'claude-sonnet-5-5', provider: 'subscription', tin: 200, tout: 30, cr: 300, cw: 50 })
  expect(inRun.cost).toBeCloseTo(0.0008775 + 0.001, 7)
  const between = out.filter((r) => r.run_id == null && r.workspace_id === a.workspace)
  expect(between.find((r) => r.session_id === a.sessionId && r.model === 'claude-sonnet-5-5')).toMatchObject({ tin: 100, tout: 10 })
  expect(between.find((r) => r.session_id == null)).toMatchObject({ tin: 7, tout: 3 })
  expect(between.find((r) => r.model === 'unknown-model-x')).toMatchObject({ provider: 'anthropic', cost: null })
  expect(out.some((r) => r.workspace_id === b.workspace)).toBe(true)
  expect(out.filter((r) => r.workspace_id === b.workspace).every((r) => r.session_id == null)).toBe(true)
  expect(await db().execute(sql`SELECT "cost_source", "gateway_tokens_in"::int AS tin FROM "runs" WHERE "id" = ${run}`).then((r) => r.rows[0])).toMatchObject({ cost_source: 'gateway', tin: 550 })

  await reconcileSessions(payload, now)
  await reconcileSessions(payload, now + 60_000)
  expect(await rows()).toEqual(out)
})

it('checkGateway stores the status and names a database newer than the image when the gateway is down', async () => {
  const { checkGateway, KNOWN_REQUEST_LOG_MIGRATION } = await import('../src/lib/session-usage')
  process.env.GATEWAY_URL = 'http://127.0.0.1:1'
  await gw.query('INSERT INTO _agentgateway_request_log_migrations VALUES ($1) ON CONFLICT DO NOTHING', [KNOWN_REQUEST_LOG_MIGRATION])
  expect(await checkGateway(payload)).toMatchObject({ up: false, migration: KNOWN_REQUEST_LOG_MIGRATION, message: expect.stringContaining('docker compose logs gateway') })
  await gw.query('INSERT INTO _agentgateway_request_log_migrations VALUES ($1)', [KNOWN_REQUEST_LOG_MIGRATION + 1])
  expect((await checkGateway(payload)).message).toMatch(/Never downgrade/)
  const { createServer } = await import('node:http')
  const srv = createServer((_, res) => res.writeHead(401).end()).listen(0)
  await new Promise((r) => srv.once('listening', r))
  process.env.GATEWAY_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  expect(await checkGateway(payload)).toMatchObject({ up: true, message: null })
  srv.close()
  const stored = (await payload.find({ collection: 'instance_state', where: { key: { equals: 'gateway' } }, ...o })).docs[0]!.value
  expect(stored).toMatchObject({ up: true })
})
