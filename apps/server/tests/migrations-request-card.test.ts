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

const NAME = '20261111_180000_request_card'

beforeAll(async () => {
  testDb = await createTestDb('migrations_request_card', undefined, { blank: true })
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

it('the migration adds the request card columns with their defaults, backfills the kind of existing drafts and reverts', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  const cols = () => run(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'intake_sessions' AND column_name IN ('title', 'kind', 'urgency', 'urgent_reason', 'edited', 'follow_up_of_id')`)
  expect((await cols()).rows).toHaveLength(0)
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO products (name, slug, workspace_id) VALUES ('p', 'p', ${ws})`)
  const product = (await run(sql`SELECT id FROM products LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO intake_sessions (product_id, workspace_id, persona, status, draft) VALUES (${product}, ${ws}, 'product-user', 'open', '{"type":"bug","problem":"x"}'::jsonb)`)

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  expect((await cols()).rows).toHaveLength(6)
  expect((await run(sql`SELECT kind, urgency FROM intake_sessions`)).rows).toEqual([{ kind: 'bug', urgency: 'normal' }])
  await expect(run(sql`INSERT INTO intake_sessions (product_id, workspace_id, persona, status, kind) VALUES (${product}, ${ws}, 'product-user', 'open', 'hotfix')`)).rejects.toThrow()
  const first = (await run(sql`SELECT id FROM intake_sessions LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO intake_sessions (product_id, workspace_id, persona, status, follow_up_of_id) VALUES (${product}, ${ws}, 'product-user', 'open', ${first})`)
  await run(sql`DELETE FROM intake_sessions WHERE id = ${first}`)
  expect((await run(sql`SELECT count(*)::int AS n FROM intake_sessions WHERE follow_up_of_id IS NULL`)).rows[0].n).toBe(1)

  await (await import('../src/migrations/20261111_180000_request_card')).down({ db: (payload.db as any).drizzle } as never)
  expect((await cols()).rows).toHaveLength(0)
}, 180_000)
