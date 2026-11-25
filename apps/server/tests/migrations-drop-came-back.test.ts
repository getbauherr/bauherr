import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, insertProduct, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261124_100000_drop_came_back'
const count = async (table: string) =>
  z.coerce.number().parse((await runSql(payload, sql.raw(`SELECT count(*) AS n FROM "${table}"`))).rows[0]?.n)

beforeAll(async () => {
  db = await bootBlankPayload('migrations_drop_came_back')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'archives the Learn events in a table that a Workspace or Ticket delete cascades to',
  async () => {
    const { migrations } = await import('../src/migrations')
    const i = migrations.findIndex((m) => m.name === NAME)
    expect(i).toBeGreaterThan(0)
    await payload.db.migrate({ migrations: migrations.slice(0, i).map(forPayload) })
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'W', slug: 'w' }, ...o })).id
    const product = await insertProduct(payload, workspace, 'p')
    const record = z.coerce.number().parse(
      (
        await runSql(
          payload,
          sql`INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number",
            "stage", "waiting_on", "rank", "version", "data", "updated_at", "created_at")
          VALUES (${workspace}, ${product}, 'github', 'a/b', 1, 'done', 'nobody', 0, 1, '{}'::jsonb, now(), now())
          RETURNING "id"`,
        )
      ).rows[0]?.id,
    )
    await runSql(
      payload,
      sql`INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "updated_at", "created_at")
        VALUES (${workspace}, ${record}, 'learn.skipped', 'factory', '{"reason":"old"}'::jsonb, now(), now())`,
    )

    await payload.db.migrate({ migrations: migrations.slice(i, i + 1).map(forPayload) })
    expect(await count('learn_events_archive')).toBe(1)

    const cascades = await runSql(
      payload,
      sql`SELECT c.confrelid::regclass::text AS parent FROM pg_constraint c
        WHERE c.contype = 'f' AND c.conrelid = 'learn_events_archive'::regclass AND c.confdeltype = 'c'
        ORDER BY 1`,
    )
    expect(cascades.rows.map((row) => row.parent)).toEqual(['records', 'workspaces'])
  },
  120_000,
)
