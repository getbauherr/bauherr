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

const NAME = '20261111_160000_chat_request_threads'

beforeAll(async () => {
  testDb = await createTestDb('migrations_chat_requests', undefined, { blank: true })
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

it('the migration adds the request flag and the intake session link with their indexes, one thread per person and request, and reverts', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  const cols = () => run(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_threads' AND column_name IN ('request', 'intake_session_id') ORDER BY 1`)
  expect((await cols()).rows).toHaveLength(0)
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO bauherren (email, role, salt, hash) VALUES ('a@x.io', 'bauherr', 's', 'h')`)
  const owner = (await run(sql`SELECT id FROM bauherren LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO products (name, slug, workspace_id) VALUES ('p', 'p', ${ws})`)
  const product = (await run(sql`SELECT id FROM products LIMIT 1`)).rows[0].id
  const session = (await run(sql`INSERT INTO intake_sessions (product_id, workspace_id, persona, status) VALUES (${product}, ${ws}, 'product-user', 'open') RETURNING id`)).rows[0].id
  await run(sql`INSERT INTO chat_threads (workspace_id, owner_id) VALUES (${ws}, ${owner})`)

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  expect((await cols()).rows).toHaveLength(2)
  expect((await run(sql`SELECT "request" FROM chat_threads`)).rows).toEqual([{ request: false }])
  await run(sql`INSERT INTO chat_threads (workspace_id, owner_id, request, intake_session_id) VALUES (${ws}, ${owner}, true, ${session})`)
  await expect(run(sql`INSERT INTO chat_threads (workspace_id, owner_id, request, intake_session_id) VALUES (${ws}, ${owner}, true, ${session})`)).rejects.toThrow()
  await run(sql`INSERT INTO chat_threads (workspace_id, owner_id, request) VALUES (${ws}, ${owner}, true)`)
  await run(sql`INSERT INTO chat_threads (workspace_id, owner_id, request) VALUES (${ws}, ${owner}, true)`)
  expect((await run(sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('chat_threads_intake_session_idx', 'chat_threads_owner_intake_session_idx') ORDER BY 1`)).rows).toHaveLength(2)
  await run(sql`DELETE FROM intake_sessions WHERE id = ${session}`)
  expect((await run(sql`SELECT count(*)::int AS n FROM chat_threads WHERE intake_session_id IS NULL`)).rows[0].n).toBe(4)

  await (await import('../src/migrations/20261111_160000_chat_request_threads')).down({ db: (payload.db as any).drizzle } as never)
  expect((await cols()).rows).toHaveLength(0)
}, 180_000)
