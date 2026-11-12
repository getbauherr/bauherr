import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const run = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)

const NAME = '20261112_160000_owner_rows'

beforeAll(async () => {
  testDb = await createTestDb('migrations_owner_rows', undefined, { blank: true })
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  const config = await (await import('../src/payload.config')).default
  payload = await getPayload({ config: { ...config, db: postgresAdapter({ pool: { connectionString: testDb.url }, push: false }) as never } })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('adds open_owner_rows (existing Tickets read 0, Payload reads and writes it); down removes it', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO products (name, slug, workspace_id) VALUES ('P', 'p', ${ws})`)
  const product = (await run(sql`SELECT id FROM products LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO tickets (title, external_id, number, url, state, stage, product_id, workspace_id) VALUES ('T', 'g1', 1, 'https://x/1', 'open', 'plan', ${product}, ${ws})`)
  await payload.db.migrate({ migrations: migrations.slice(i) as never })
  const o = { overrideAccess: true, depth: 0 } as const
  const t = (await payload.find({ collection: 'tickets', ...o })).docs[0]!
  expect(t).toMatchObject({ openOwnerRows: 0 })
  expect(await payload.update({ collection: 'tickets', id: t.id, data: { openOwnerRows: 2 } as never, ...o })).toMatchObject({ openOwnerRows: 2 })
  await (await import('../src/migrations/20261112_160000_owner_rows')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'open_owner_rows'`)).rows[0].n).toBe(0)
}, 180_000)
