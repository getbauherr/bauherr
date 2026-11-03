import { readdirSync } from 'node:fs'
import { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrationNames, renderMigrations } from '../scripts/gen-migrations'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('273_migrations_registry')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const dir = new URL('../src/migrations/', import.meta.url)

it('the generated registry lists every migration file once, sorted by name', async () => {
  const names = migrationNames(readdirSync(dir))
  expect(names.length).toBeGreaterThan(30)
  expect(names).toEqual([...names].sort())
  expect((await import('../src/migrations')).migrations.map((m) => m.name)).toEqual(names)
})

it('keeps the order the hand-edited index had (prefix is frozen)', async () => {
  const { migrations } = await import('../src/migrations')
  expect(migrations.slice(0, 3).map((m) => m.name)).toEqual(['20261029_165423_initial', '20261030_000000_reconcile_costs', '20261030_120000_provider_presets'])
  expect(migrations.at(-1)?.name).toBe(migrationNames(readdirSync(dir)).at(-1))
})

it('renders the registry shape', () => {
  expect(renderMigrations(['20260101_000000_a'])).toBe(
    "import * as migration_20260101_000000_a from './20260101_000000_a';\n\nexport const migrations = [\n  {\n    up: migration_20260101_000000_a.up,\n    down: migration_20260101_000000_a.down,\n    name: '20260101_000000_a'\n  }\n];\n",
  )
})

it('rejects malformed and duplicate names', () => {
  expect(() => migrationNames(['bad_name.ts'])).toThrow(/must match/)
  expect(() => migrationNames(['20260101_000000_A.ts'])).toThrow(/must match/)
  expect(() => migrationNames(['20260101_000000_a.ts', '20260101_000000_a.ts'])).toThrow(/duplicate/)
})

it('syncJobEnums adds a missing slug and is a no-op on the second call', async () => {
  const { syncJobEnums } = await import('../src/jobs')
  const { sql } = await import('@payloadcms/db-postgres')
  const labels = async () => ((await payload.db.drizzle.execute(sql`SELECT unnest(enum_range(NULL::enum_payload_jobs_task_slug))::text AS v`)).rows as { v: string }[]).map((r) => r.v)
  expect(await labels()).not.toContain('new-test-task')
  await syncJobEnums(payload, ['new-test-task'])
  await syncJobEnums(payload, ['new-test-task'])
  expect((await labels()).filter((v) => v === 'new-test-task')).toHaveLength(1)
})
