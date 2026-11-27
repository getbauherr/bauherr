import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import {
  bootBlankPayload,
  forPayload,
  insertConnection,
  insertProduct,
  insertSource,
  runSql,
  type MigrationDb,
} from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261120_210000_reset_sync_position'
const position = z.object({
  repo: z.string(),
  cursor: z.string().nullable(),
  imported_at: z.unknown(),
  lookback_at: z.unknown(),
  reconciled_at: z.unknown(),
})
const stored = async () =>
  z.array(position).parse((await runSql(payload, sql`SELECT * FROM "ticket_sources" ORDER BY "id"`)).rows)

beforeAll(async () => {
  db = await bootBlankPayload('migrations_reset_sync_position')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'a source that polled under the old engine starts its import again from the beginning',
  async () => {
    const { migrations } = await import('../src/migrations')
    const i = migrations.findIndex((m) => m.name === NAME)
    expect(i).toBeGreaterThan(0)
    await payload.db.migrate({ migrations: migrations.slice(0, i).map(forPayload) })
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'W', slug: 'w' }, ...o })).id
    const product = await insertProduct(payload, workspace, 'p')
    const connection = await insertConnection(payload, workspace, 'gh')
    await insertSource(payload, { repo: 'acme/app', product, connection, workspace })
    await runSql(
      payload,
      sql`UPDATE "ticket_sources" SET "cursor" = '2026-11-19T08:00:00.000Z', "imported_at" = now(),
        "lookback_at" = now(), "reconciled_at" = now()`,
    )

    await payload.db.migrate({ migrations: migrations.slice(i).map(forPayload) })

    expect(await stored()).toEqual([
      { repo: 'acme/app', cursor: null, imported_at: null, lookback_at: null, reconciled_at: null },
    ])
  },
  120_000,
)
