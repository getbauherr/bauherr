import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const run = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)

const NAME = '20261112_170000_forge_channel'

beforeAll(async () => {
  testDb = await createTestDb('migrations_forge_channel', undefined, { blank: true })
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

it('keeps the logins an account holds (case ignored), moves the rest to unlinked_gate_owners and drops gate_owners; down brings the list back', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO bauherren (email, role, salt, hash, github_login) VALUES ('a@x.io', 'admin', 's', 'h', 'Alice'), ('b@x.io', 'bauherr', 's', 'h', 'bob'), ('c@x.io', 'bauherr', 's', 'h', NULL)`)
  await run(sql`INSERT INTO products (name, slug, workspace_id, gate_owners) VALUES
    ('Mixed', 'mixed', ${ws}, 'alice, ghost , @Dana,BOB'),
    ('Matched', 'matched', ${ws}, 'bob'),
    ('Empty', 'empty', ${ws}, ''),
    ('Never', 'never', ${ws}, NULL)`)
  await payload.db.migrate({ migrations: migrations.slice(i) as never })

  const o = { overrideAccess: true, depth: 0, pagination: false, sort: 'slug' } as const
  const products = (await payload.find({ collection: 'products', ...o })).docs as Record<string, any>[]
  expect(products.map((p) => [p.slug, p.unlinkedGateOwners ?? null])).toEqual([['empty', null], ['matched', null], ['mixed', 'ghost,Dana'], ['never', null]])
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'gate_owners'`)).rows[0].n).toBe(0)
  // the matched logins stay on their accounts, untouched
  expect(((await payload.find({ collection: 'bauherren', ...o })).docs as Record<string, any>[]).map((u) => u.githubLogin ?? null).sort()).toEqual(['Alice', 'bob', null])

  await (await import('../src/migrations/20261112_170000_forge_channel')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT slug, gate_owners FROM products ORDER BY slug`)).rows).toEqual([
    { slug: 'empty', gate_owners: null },
    { slug: 'matched', gate_owners: null },
    { slug: 'mixed', gate_owners: 'ghost,Dana' },
    { slug: 'never', gate_owners: null },
  ])
}, 180_000)
