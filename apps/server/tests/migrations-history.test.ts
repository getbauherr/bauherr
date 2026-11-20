import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
const run = (q: ReturnType<typeof sql>) => runSql(payload, q)
const countOf = async (q: ReturnType<typeof sql>) =>
  z.number().parse(z.array(z.record(z.string(), z.unknown())).parse((await run(q)).rows)[0].n)

beforeAll(async () => {
  process.env.GATEWAY_ADMIN_URL = 'http://127.0.0.1:1'
  process.env.GATEWAY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'bauherr-gw-'))
  db = await bootBlankPayload('migrations_history')
  payload = db.payload
}, 120_000)

afterAll(async () => {
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.GATEWAY_CONFIG_DIR
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it('an install seeded at the oldest schema with a Connection survives every later migration', async () => {
  const { migrations } = await import('../src/migrations')
  const [oldest, ...later] = migrations
  await payload.db.migrate({ migrations: [forPayload(oldest)] })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('Old', 'old')`)
  await run(
    sql`INSERT INTO connections (workspace_id, name, kind, config) SELECT id, 'LLM', 'llm-provider',
      '{"provider":"anthropic"}' FROM workspaces`,
  )
  await expect(payload.db.migrate({ migrations: later.map(forPayload) })).resolves.not.toThrow()
  expect(await countOf(sql`SELECT count(*)::int AS n FROM payload_migrations`)).toBe(migrations.length)
  const cols = (
    await run(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'connections' AND column_name = 'slug'`,
    )
  ).rows
  expect(cols).toHaveLength(1)
}, 180_000)
