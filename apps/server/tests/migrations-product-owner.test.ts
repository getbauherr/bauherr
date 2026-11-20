import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const run = (q: ReturnType<typeof sql>) => runSql(payload, q)
const resultRows = async (q: ReturnType<typeof sql>) =>
  z.array(z.record(z.string(), z.unknown())).parse((await run(q)).rows)
const countOf = async (q: ReturnType<typeof sql>) => z.number().parse((await resultRows(q))[0].n)
const roleRange = async () =>
  z.string().parse((await resultRows(sql`SELECT enum_range(NULL::enum_bauherren_role)::text AS r`))[0].r)

const NAME = '20261112_110000_product_owner'

beforeAll(async () => {
  db = await bootBlankPayload('migrations_product_owner')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'the migration adds the Product owner role and assignments that Payload ' +
    'reads and writes; down removes them with the accounts',
  async () => {
    const { migrations } = await import('../src/migrations')
    const i = migrations.findIndex((m) => m.name === NAME)
    expect(i).toBeGreaterThan(0)
    await payload.db.migrate({ migrations: migrations.slice(0, i).map(forPayload) })
    expect(await roleRange()).toBe('{admin,bauherr}')
    await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)

    await payload.db.migrate({ migrations: migrations.slice(i).map(forPayload) })
    expect(await roleRange()).toBe('{admin,bauherr,product-owner}')
    const o = { overrideAccess: true } as const
    const ws = (await payload.find({ collection: 'workspaces', limit: 1, ...o })).docs[0].id
    const product = await payload.create({
      collection: 'products',
      data: { name: 'P', slug: 'p', workspace: ws },
      ...o,
    })
    await payload.create({
      collection: 'bauherren',
      data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' },
      ...o,
    })
    const owner = await payload.create({
      collection: 'bauherren',
      data: {
        email: 'po@x.io',
        password: 'pw-123456',
        role: 'product-owner',
        assignments: [{ workspace: ws, scope: 'products', products: [product.id] }],
      },
      ...o,
    })
    expect(await payload.findByID({ collection: 'bauherren', id: owner.id, depth: 0, ...o })).toMatchObject({
      role: 'product-owner',
      assignments: [{ workspace: ws, scope: 'products', products: [product.id] }],
      tenants: [{ tenant: ws }],
    })
    expect(await countOf(sql`SELECT count(*)::int AS n FROM bauherren_rels WHERE products_id = ${product.id}`)).toBe(1)

    const productOwner = await import('../src/migrations/20261112_110000_product_owner')
    await forPayload({ name: NAME, ...productOwner }).down({ db: payload.db.drizzle, payload })
    expect(await roleRange()).toBe('{admin,bauherr}')
    expect((await resultRows(sql`SELECT email FROM bauherren ORDER BY id`)).map((r) => r.email)).toEqual(['a@x.io'])
    expect(
      await countOf(
        sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('bauherren_assignments',
          'bauherren_rels')`,
      ),
    ).toBe(0)
  },
  180_000,
)
