import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, insertProduct, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261125_130000_drop_statements'
const exists = async (table: string) =>
  z.string().nullable().parse((await runSql(payload, sql`SELECT to_regclass(${table}) AS t`)).rows[0]?.t) !== null

beforeAll(async () => {
  db = await bootBlankPayload('migrations_drop_statements')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'drops only the statements table and brings it back empty on down',
  async () => {
    const { migrations } = await import('../src/migrations')
    const i = migrations.findIndex((m) => m.name === NAME)
    expect(i).toBeGreaterThan(0)
    await payload.db.migrate({ migrations: migrations.slice(0, i).map(forPayload) })
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'W', slug: 'w' }, ...o })).id
    const product = await insertProduct(payload, workspace, 'p')
    await runSql(
      payload,
      sql`INSERT INTO "statements" ("workspace_id", "product_id", "kind", "text", "updated_at", "created_at")
        VALUES (${workspace}, ${product}, 'written', 'Old memory.', now(), now())`,
    )
    expect(await exists('statements')).toBe(true)

    await payload.db.migrate({ migrations: migrations.slice(0, i + 1).map(forPayload) })
    expect(await exists('statements')).toBe(false)
    expect(await exists('products')).toBe(true)
    expect(await exists('memory_document_versions')).toBe(true)

    const target = migrations[i]
    if (!target) throw new Error('migration missing')
    await forPayload(target).down({ db: payload.db.drizzle, payload })
    expect(await exists('statements')).toBe(true)
    const left = await runSql(payload, sql`SELECT count(*) AS n FROM "statements"`)
    expect(z.coerce.number().parse(left.rows[0]?.n)).toBe(0)
  },
  120_000,
)
