import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261123_120000_someday_label'
const labels = z.object({ slug: z.string(), intake_excluded_labels: z.array(z.string()) })

beforeAll(async () => {
  db = await bootBlankPayload('migrations_someday_label')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'adds the Someday label once to every existing Product and keeps its own labels',
  async () => {
    const { migrations } = await import('../src/migrations')
    const i = migrations.findIndex((m) => m.name === NAME)
    expect(i).toBeGreaterThan(0)
    await payload.db.migrate({ migrations: migrations.slice(0, i).map(forPayload) })
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'W', slug: 'w' }, ...o })).id
    for (const slug of ['plain', 'custom', 'already']) {
      await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })
    }
    await runSql(
      payload,
      sql`UPDATE "products" SET "intake_excluded_labels" = CASE "slug"
        WHEN 'custom' THEN '["wontfix"]'::jsonb WHEN 'already' THEN '["bauherr:someday"]'::jsonb END
        WHERE "slug" <> 'plain'`,
    )

    await payload.db.migrate({ migrations: migrations.slice(i).map(forPayload) })

    const found = z
      .array(labels)
      .parse((await runSql(payload, sql`SELECT "slug", "intake_excluded_labels" FROM "products" ORDER BY "slug"`)).rows)
    expect(found).toEqual([
      { slug: 'already', intake_excluded_labels: ['bauherr:someday'] },
      { slug: 'custom', intake_excluded_labels: ['wontfix', 'bauherr:someday'] },
      { slug: 'plain', intake_excluded_labels: ['bauherr:someday'] },
    ])
  },
  120_000,
)
