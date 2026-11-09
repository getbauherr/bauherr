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
  testDb = await createTestDb('migrations_history', undefined, { blank: true })
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

it('an install seeded at the oldest schema with a Connection survives every later migration', async () => {
  const { migrations } = await import('../src/migrations')
  const [oldest, ...later] = migrations
  await payload.db.migrate({ migrations: [oldest] as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('Old', 'old')`)
  await run(sql`INSERT INTO connections (workspace_id, name, kind, config) SELECT id, 'LLM', 'llm-provider', '{"provider":"anthropic"}' FROM workspaces`)
  await expect(payload.db.migrate({ migrations: later as never })).resolves.not.toThrow()
  expect((await run(sql`SELECT count(*)::int AS n FROM payload_migrations`)).rows[0].n).toBe(migrations.length)
  const cols = (await run(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'connections' AND column_name = 'slug'`)).rows
  expect(cols).toHaveLength(1)
}, 180_000)
