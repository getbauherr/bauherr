import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, insertProduct, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261123_140000_statement_memory'
const stored = async () =>
  z
    .array(
      z.object({
        text: z.string(),
        applies: z.string(),
        area: z.string().nullable(),
        stages: z.array(z.string()),
        off: z.boolean(),
        original_text: z.string().nullable(),
      }),
    )
    .parse(
      (
        await runSql(
          payload,
          sql`SELECT "text", "applies", "area", "stages", "off", "original_text" FROM "statements" ORDER BY "id"`,
        )
      ).rows,
    )

beforeAll(async () => {
  db = await bootBlankPayload('migrations_statement_memory')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'keeps the text of every existing row and makes it a fit memory for every stage, on, unedited',
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
          VALUES (${workspace}, ${product}, 'github', 'a/b', 1, 'intake', 'agents', 0, 1, '{}'::jsonb, now(), now())
          RETURNING "id"`,
        )
      ).rows[0]?.id,
    )
    for (const [kind, text] of [
      ['answer', 'Use Sie.'],
      ['send-back', 'Keep the button.'],
    ]) {
      await runSql(
        payload,
        sql`INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "text")
          VALUES (${workspace}, ${product}, ${record}, ${kind}, ${text})`,
      )
    }

    await payload.db.migrate({ migrations: migrations.slice(i).map(forPayload) })

    const every = ['brief', 'build', 'review', 'verify']
    const kept = { applies: 'fit', area: null, stages: every, off: false, original_text: null }
    expect(await stored()).toEqual([
      { text: 'Use Sie.', ...kept },
      { text: 'Keep the button.', ...kept },
    ])
  },
  120_000,
)
