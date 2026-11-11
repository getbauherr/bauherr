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

const NAME = '20261111_100000_progress'

beforeAll(async () => {
  testDb = await createTestDb('migrations_progress', undefined, { blank: true })
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

it('the migration turns progress comments on for existing Workspaces, adds the Ticket columns and the template and job values, and reverses', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('Old', 'old')`)
  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  expect((await run(sql`SELECT progress_comments FROM workspaces`)).rows[0].progress_comments).toBe(true)
  const cols = (await run(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets' AND column_name LIKE 'progress_%' ORDER BY 1`)).rows.map((r: any) => r.column_name)
  expect(cols).toEqual(['progress_comment_id', 'progress_hash', 'progress_notified'])
  await run(sql`INSERT INTO templates (workspace_id, name, body) SELECT id, 'progress', '## Received {#received}' FROM workspaces`)
  expect((await run(sql`SELECT 'sync-progress'::enum_payload_jobs_task_slug AS s`)).rows[0].s).toBe('sync-progress')
  const m = migrations[i]!
  await (m.down as (a: unknown) => Promise<void>)({ db: (payload.db as any).drizzle, payload, req: {} })
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'tickets' AND column_name LIKE 'progress_%'`)).rows[0].n).toBe(0)
})
