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

const NAME = '20261112_100000_artifacts'

beforeAll(async () => {
  testDb = await createTestDb('migrations_artifacts', undefined, { blank: true })
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

it('the migration adds artifacts and the recording media types, rows follow their Ticket on delete, and it reverts', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'artifacts'`)).rows[0].n).toBe(0)
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO products (name, slug, workspace_id) VALUES ('p', 'p', ${ws})`)
  const product = (await run(sql`SELECT id FROM products LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO tickets (title, external_id, number, product_id, workspace_id) VALUES ('t', 'x', 1, ${product}, ${ws})`)
  const ticket = (await run(sql`SELECT id FROM tickets LIMIT 1`)).rows[0].id

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  // Raw SQL, not the Payload API: the API reads related rows with today's schema, which later migrations (not applied here) extend.
  await run(sql`INSERT INTO artifacts (ticket_id, workspace_id, kind, title, pair, sha, rule) VALUES (${ticket}, ${ws}, 'image', 'Before', 'before', 'abc', 'Screens')`)
  await run(sql`INSERT INTO media (workspace_id, name, mime) VALUES (${ws}, 'clip.webm', 'video/webm')`)
  expect((await run(sql`SELECT count(*)::int AS n FROM artifacts`)).rows[0].n).toBe(1)
  await run(sql`DELETE FROM tickets WHERE id = ${ticket}`)
  expect((await run(sql`SELECT count(*)::int AS n FROM artifacts`)).rows[0].n).toBe(0)

  await (await import('../src/migrations/20261112_100000_artifacts')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'artifacts'`)).rows[0].n).toBe(0)
}, 180_000)
