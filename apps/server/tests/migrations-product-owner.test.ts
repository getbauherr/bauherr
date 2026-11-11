import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const run = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)

const NAME = '20261112_110000_product_owner'

beforeAll(async () => {
  testDb = await createTestDb('migrations_product_owner', undefined, { blank: true })
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

it('the migration adds the Product owner role and assignments that Payload reads and writes; down removes them with the accounts', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  expect((await run(sql`SELECT enum_range(NULL::enum_bauherren_role)::text AS r`)).rows[0].r).toBe('{admin,bauherr}')
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  expect((await run(sql`SELECT enum_range(NULL::enum_bauherren_role)::text AS r`)).rows[0].r).toBe('{admin,bauherr,product-owner}')
  const o = { overrideAccess: true } as const
  const ws = (await payload.find({ collection: 'workspaces', limit: 1, ...o })).docs[0]!.id
  const product = await payload.create({ collection: 'products', data: { name: 'P', slug: 'p', workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  const owner = await payload.create({ collection: 'bauherren', data: { email: 'po@x.io', password: 'pw-123456', role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [product.id] }] } as never, ...o })
  expect(await payload.findByID({ collection: 'bauherren', id: owner.id, depth: 0, ...o })).toMatchObject({ role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [product.id] }], tenants: [{ tenant: ws }] })
  expect((await run(sql`SELECT count(*)::int AS n FROM bauherren_rels WHERE products_id = ${product.id}`)).rows[0].n).toBe(1)

  await (await import('../src/migrations/20261112_110000_product_owner')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT enum_range(NULL::enum_bauherren_role)::text AS r`)).rows[0].r).toBe('{admin,bauherr}')
  expect((await run(sql`SELECT email FROM bauherren ORDER BY id`)).rows.map((r: { email: string }) => r.email)).toEqual(['a@x.io'])
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('bauherren_assignments', 'bauherren_rels')`)).rows[0].n).toBe(0)
}, 180_000)
