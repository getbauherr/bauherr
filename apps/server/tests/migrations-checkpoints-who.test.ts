import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const run = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)

const NAME = '20261112_150000_checkpoints_who'

beforeAll(async () => {
  testDb = await createTestDb('migrations_checkpoints_who', undefined, { blank: true })
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

it('adds needs_by (backfilled: every existing need asked the Bauherr), the touch fields and the Product switch; down removes them', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  const ws = (await run(sql`SELECT id FROM workspaces LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO products (name, slug, workspace_id) VALUES ('P', 'p', ${ws})`)
  const product = (await run(sql`SELECT id FROM products LIMIT 1`)).rows[0].id
  await run(sql`INSERT INTO tickets (title, external_id, number, url, state, stage, product_id, workspace_id, needs_you) VALUES ('Waits', 'g1', 1, 'https://x/1', 'open', 'plan', ${product}, ${ws}, 'Approve plan'), ('Free', 'g2', 2, 'https://x/2', 'open', 'build', ${product}, ${ws}, NULL)`)
  await run(sql`INSERT INTO human_touches (kind, actor, at, workspace_id) VALUES ('approve:plan', 'a@x.io', now(), ${ws})`)

  await payload.db.migrate({ migrations: migrations.slice(i) as never })
  const o = { overrideAccess: true, depth: 0 } as const
  const tickets = (await payload.find({ collection: 'tickets', sort: 'number', ...o })).docs as unknown as { number: number; needsBy: string | null }[]
  expect(tickets.map((t) => [t.number, t.needsBy ?? null])).toEqual([[1, 'bauherr'], [2, null]])
  expect((await payload.find({ collection: 'products', ...o })).docs[0]).toMatchObject({ productOwnerTestsStaging: false })
  expect((await payload.find({ collection: 'human_touches', ...o })).docs[0]).toMatchObject({ kind: 'approve:plan', actor: 'a@x.io' })

  const touch = await payload.create({ collection: 'human_touches', data: { kind: 'accept:staging', workspace: ws, actor: 'po@x.io', as: 'product-owner', addressee: 'product-owner', at: new Date().toISOString() }, ...o })
  expect(touch).toMatchObject({ as: 'product-owner', addressee: 'product-owner' })
  const free = (await payload.find({ collection: 'tickets', where: { number: { equals: 2 } }, ...o })).docs[0]!
  expect(await payload.update({ collection: 'tickets', id: free.id, data: { needsBy: 'product-owner' } as never, ...o })).toMatchObject({ needsBy: 'product-owner' })

  await (await import('../src/migrations/20261112_150000_checkpoints_who')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE (table_name = 'tickets' AND column_name = 'needs_by') OR (table_name = 'human_touches' AND column_name IN ('as', 'addressee')) OR (table_name = 'products' AND column_name = 'product_owner_tests_staging')`)).rows[0].n).toBe(0)
  expect((await run(sql`SELECT count(*)::int AS n FROM tickets`)).rows[0].n).toBe(2)
}, 180_000)
