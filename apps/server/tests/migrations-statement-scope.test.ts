import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, insertProduct, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261123_130000_statement_scope'
const stored = async () =>
  z
    .array(z.object({ kind: z.string(), scope: z.string() }))
    .parse((await runSql(payload, sql`SELECT "kind", "scope" FROM "statements" ORDER BY "id"`)).rows)

beforeAll(async () => {
  db = await bootBlankPayload('migrations_statement_scope')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'gives answers the product scope and every other statement the ticket scope',
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
    for (const kind of ['answer', 'send-back', 'brief-change', 'guidance']) {
      await runSql(
        payload,
        sql`INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "text")
          VALUES (${workspace}, ${product}, ${record}, ${kind}, 'x')`,
      )
    }

    await payload.db.migrate({ migrations: migrations.slice(i).map(forPayload) })

    expect(await stored()).toEqual([
      { kind: 'answer', scope: 'product' },
      { kind: 'send-back', scope: 'ticket' },
      { kind: 'brief-change', scope: 'ticket' },
      { kind: 'guidance', scope: 'ticket' },
    ])
  },
  120_000,
)
