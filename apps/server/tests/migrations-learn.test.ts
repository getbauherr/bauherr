import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const o = { overrideAccess: true } as const
const NAME = '20261123_160000_learn'

beforeAll(async () => {
  db = await bootBlankPayload('migrations_learn')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it(
  'marks an accepted ticket that is done as skipped by Learn, and leaves open and unaccepted tickets alone',
  async () => {
    const { migrations } = await import('../src/migrations')
    const i = migrations.findIndex((m) => m.name === NAME)
    expect(i).toBeGreaterThan(0)
    await payload.db.migrate({ migrations: migrations.slice(0, i).map(forPayload) })
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'W', slug: 'w' }, ...o })).id
    const product = (await payload.create({ collection: 'products', data: { name: 'P', slug: 'p', workspace }, ...o }))
      .id
    const record = async (number: number, stage: string, events: string[]) => {
      const inserted = await runSql(
        payload,
        sql`INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number",
          "stage", "waiting_on", "rank", "version", "data", "updated_at", "created_at")
        VALUES (${workspace}, ${product}, 'github', 'a/b', ${number}, ${stage}, 'nobody', 0, 1, '{}'::jsonb,
          now(), now()) RETURNING "id"`,
      )
      const id = z.coerce.number().parse(inserted.rows[0]?.id)
      for (const type of events) {
        await runSql(
          payload,
          sql`INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "updated_at", "created_at")
            VALUES (${workspace}, ${id}, ${type}, 'owner', '{}'::jsonb, now(), now())`,
        )
      }
      return id
    }
    const finished = await record(1, 'done', ['result.accepted'])
    await record(2, 'done', ['ticket.closed'])
    await record(3, 'ship', ['result.accepted'])

    await payload.db.migrate({ migrations: migrations.slice(i).map(forPayload) })

    const skipped = z
      .array(z.object({ record_id: z.coerce.number() }))
      .parse((await runSql(payload, sql`SELECT "record_id" FROM "events" WHERE "type" = 'learn.skipped'`)).rows)
    expect(skipped.map((row) => row.record_id)).toEqual([finished])
  },
  120_000,
)
