import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import type { Migration, Payload } from 'payload'
import { createTestDb, type TestDb } from './test-db'

export type MigrationDb = { payload: Payload; testDb: TestDb }

export const bootBlankPayload = async (suite: string): Promise<MigrationDb> => {
  const testDb = await createTestDb(suite, undefined, { blank: true })
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  const config = await (await import('../../src/payload.config')).default
  const adapter = postgresAdapter({ pool: { connectionString: testDb.url }, push: false })
  const payload = await getPayload({
    config: {
      ...config,
      db: { ...adapter, allowIDOnCreate: adapter.allowIDOnCreate ?? false, name: adapter.name ?? 'postgres' },
    },
  })
  return { payload, testDb }
}

export type RegisteredMigration = {
  name: string
  up: (args: MigrateUpArgs) => Promise<void>
  down: (args: MigrateDownArgs) => Promise<void>
}

const hasDb = (args: unknown): args is { db: unknown; payload: unknown } =>
  typeof args === 'object' && args !== null && 'db' in args && 'payload' in args

const forwarded =
  <A extends { db: unknown; payload: unknown }>(call: (args: A) => Promise<void>) =>
  (args: unknown): Promise<void> => {
    if (!hasDb(args)) throw new Error('a migration is called with the database and Payload')
    return call(args as A)
  }

export const migrationUp = (m: Pick<RegisteredMigration, 'up'>) => forwarded(m.up)

export const forPayload = (m: RegisteredMigration): Migration => ({
  name: m.name,
  up: forwarded(m.up),
  down: forwarded(m.down),
})

export const runSql = (payload: Payload, q: ReturnType<typeof sql>) => payload.db.drizzle.execute(q)

const idOf = (result: Awaited<ReturnType<typeof runSql>>): number => Number(result.rows[0]?.id)

type Id = string | number

export const insertProduct = async (payload: Payload, workspace: Id, slug: string): Promise<number> =>
  idOf(
    await runSql(
      payload,
      sql`INSERT INTO "products" ("name", "slug", "state", "workspace_id", "updated_at", "created_at")
        VALUES (${slug}, ${slug}, 'observing', ${workspace}, now(), now()) RETURNING "id"`,
    ),
  )

export const insertSource = async (
  payload: Payload,
  o: { repo: string; product: Id; connection: Id; workspace: Id },
): Promise<number> =>
  idOf(
    await runSql(
      payload,
      sql`INSERT INTO "ticket_sources"
          ("repo", "product_id", "connection_id", "workspace_id", "updated_at", "created_at")
        VALUES (${o.repo}, ${o.product}, ${o.connection}, ${o.workspace}, now(), now()) RETURNING "id"`,
    ),
  )
