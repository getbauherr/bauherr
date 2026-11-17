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

beforeAll(async () => {
  testDb = await createTestDb('migrations_stage_jobs', undefined, { blank: true })
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

const columns = async () => (await run(sql`SELECT table_name, column_name FROM information_schema.columns WHERE (table_name, column_name) IN (('runs', 'job'), ('ticket_events', 'job'), ('tickets', 'stage_since')) ORDER BY 1`)).rows.length

it('Runs of one stage may differ by job, the same job twice is refused, and down restores the one-per-stage index', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === '20261118_100000_stage_jobs')
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  expect(await columns()).toBe(0)
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  await run(sql`INSERT INTO products (name, slug, workspace_id) SELECT 'P', 'p', id FROM workspaces`)
  await run(sql`INSERT INTO tickets (workspace_id, product_id, external_id, number, title, stage) SELECT workspace_id, id, 'e', '1', 't', 'plan' FROM products`)

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  expect(await columns()).toBe(3)
  const start = (job: string | null) => run(sql`INSERT INTO runs (ticket_id, stage, kind, job, status, mode, workspace_id) SELECT id, 'audit', 'agent', ${job}, 'queued', 'autonomous', workspace_id FROM tickets`)
  await start(null)
  await start('security')
  await start('ux')
  await expect(start('ux')).rejects.toMatchObject({ cause: { constraint: 'runs_active_per_ticket_stage' } })
  await expect(start(null)).rejects.toMatchObject({ cause: { constraint: 'runs_active_per_ticket_stage' } })

  await run(sql`DELETE FROM runs WHERE job IS NOT NULL`)
  await (await import('../src/migrations/20261118_100000_stage_jobs')).down({ db: (payload.db as any).drizzle } as never)
  expect(await columns()).toBe(0)
  const plain = () => run(sql`INSERT INTO runs (ticket_id, stage, kind, status, mode, workspace_id) SELECT id, 'audit', 'agent', 'queued', 'autonomous', workspace_id FROM tickets`)
  await expect(plain()).rejects.toMatchObject({ cause: { constraint: 'runs_active_per_ticket_stage' } })
}, 180_000)
