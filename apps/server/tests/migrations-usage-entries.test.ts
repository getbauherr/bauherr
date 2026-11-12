import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const run = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)

const NAME = '20261111_140000_usage_entries'

beforeAll(async () => {
  testDb = await createTestDb('migrations_usage_entries', undefined, { blank: true })
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_ADMIN_URL = 'http://127.0.0.1:1'
  process.env.GATEWAY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'bauherr-gw-'))
  const { getPayload } = await import('payload')
  const config = await (await import('../src/payload.config')).default
  payload = await getPayload({ config: { ...config, db: postgresAdapter({ pool: { connectionString: testDb.url }, push: false }) as never } })
}, 120_000)

afterAll(async () => {
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.GATEWAY_CONFIG_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('the migration adds usage_entries, usage_cursors and the session-reported cost source, backfills gateway Runs, and reverts', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'usage_entries'`)).rows[0].n).toBe(0)
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO products (name, slug, workspace_id) VALUES ('p', 'p', ${ws})`)
  const product = (await run(sql`SELECT id FROM products LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO tickets (title, external_id, number, product_id, workspace_id) VALUES ('t', 'x', 1, ${product}, ${ws})`)
  const ticket = (await run(sql`SELECT id FROM tickets LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO runs (ticket_id, stage, workspace_id, cost_source, gateway_cost_usd, gateway_tokens_in, gateway_tokens_out, model) VALUES (${ticket}, 'build', ${ws}, 'gateway', 0.5, 10, 5, 'claude-opus-5-5')`)

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  // the Payload API below reads with today's schema, which later migrations extend
  await payload.db.migrate({ migrations: migrations.slice(i + 1) as never })
  const o = { overrideAccess: true } as const
  const backfilled = (await run(sql`SELECT model, source::text AS source, cost_usd::float8 AS cost FROM usage_entries`)).rows
  expect(backfilled).toEqual([{ model: 'claude-opus-5-5', source: 'gateway', cost: 0.5 }])
  const runId = (await run(sql`SELECT id FROM runs LIMIT 1`)).rows[0].id
  await payload.create({ collection: 'usage_entries', data: { run: runId, workspace: ws, model: 'claude-haiku-5-5', source: 'session-reported', tokensIn: 1, at: new Date().toISOString() } as never, ...o })
  await expect(run(sql`INSERT INTO usage_entries (workspace_id, run_id, model, source, at) VALUES (${ws}, ${runId}, 'claude-haiku-5-5', 'session-reported', now())`)).rejects.toThrow()
  await run(sql`UPDATE runs SET cost_source = 'session-reported' WHERE id = ${runId}`)
  const session = (await run(sql`INSERT INTO agent_sessions (workspace_id, public_id, role) VALUES (${ws}, 'ses_m', 'engineer') RETURNING id`)).rows[0].id
  await payload.create({ collection: 'usage_cursors', data: { session, claudeSession: 'cc', totals: { m: [1, 2, 3, 4] }, workspace: ws } as never, ...o })
  await expect(run(sql`INSERT INTO usage_cursors (workspace_id, session_id, claude_session) VALUES (${ws}, ${session}, 'cc')`)).rejects.toThrow()
  expect((await run(sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('run_source_model_idx', 'workspace_source_at_idx', 'session_claude_session_idx') ORDER BY 1`)).rows).toHaveLength(3)

  await (await import('../src/migrations/20261111_140000_usage_entries')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'usage_entries'`)).rows[0].n).toBe(0)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'usage_cursors'`)).rows[0].n).toBe(0)
}, 180_000)
