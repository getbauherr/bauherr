import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')
const DEFAULT_BASE = 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'

export type TestDb = { url: string; drop: (payload?: { db: unknown }) => Promise<void> }

/** `$VITEST_DB_SUFFIX`, else empty under `$CI`, else a short hash of the repo root (one per worktree). */
export const dbSuffix = (repoRoot = root, env: Record<string, string | undefined> = process.env): string =>
  env.VITEST_DB_SUFFIX ?? (env.CI ? '' : createHash('sha1').update(repoRoot).digest('hex').slice(0, 6))

export const testDbName = (suite: string, suffix = dbSuffix()): string => {
  const name = `bauherr_test_${suite}${suffix ? `_${suffix}` : ''}`
  if (name.length > 63) throw new Error(`test database name too long: ${name}`)
  return name
}

const withDb = (base: string, db: string) => base.replace(/\/[^/]+$/, `/${db}`)
const admin = async (base: string, sql: string) => {
  const client = new pg.Client({ connectionString: withDb(base, 'postgres') })
  await client.connect()
  try {
    return (await client.query(sql)).rows
  } finally {
    await client.end()
  }
}

/** Database with the schema already pushed, built once per run by `global-setup.ts`; test databases are cloned from it and skip Payload's push. */
export const templateDbName = (suffix = dbSuffix()) => testDbName('template', suffix)

/** The template of this run: `global-setup.ts` sets `BAUHERR_TEST_TEMPLATE_DB` before the workers start; without it (a single file run) the worktree's name. */
const runTemplateDbName = () => process.env.BAUHERR_TEST_TEMPLATE_DB ?? templateDbName()

/** Builds the template database; returns the function that drops it. */
export const buildTemplateDb = async (base = process.env.DATABASE_URL ?? DEFAULT_BASE) => {
  const name = runTemplateDbName()
  await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin(base, `CREATE DATABASE ${name}`)
  const saved = { ...process.env }
  Object.assign(process.env, { DATABASE_URL: withDb(base, name), PAYLOAD_SECRET: 'test-secret', ENCRYPTION_KEY: 'test-key' })
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  ;(payload.db as unknown as { pool?: pg.Pool }).pool?.on('error', () => {})
  await payload.destroy()
  await admin(base, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`)
  process.env = saved
  return async () => void (await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))
}

/** Drops and recreates `bauherr_test_<suite>[_<suffix>]` as a clone of the template (unless `blank`, for tests that run migrations on an empty database) when `global-setup.ts` built one; `drop(payload)` silences the payload pool's errors from the forced disconnect and removes it (call after `payload.destroy()`). */
export const createTestDb = async (suite: string, base = process.env.DATABASE_URL ?? DEFAULT_BASE, { blank = false } = {}): Promise<TestDb> => {
  const name = testDbName(suite)
  const template = runTemplateDbName()
  const hasTemplate = !blank && (await admin(base, `SELECT 1 FROM pg_database WHERE datname = '${template}'`)).length > 0
  await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin(base, `CREATE DATABASE ${name}${hasTemplate ? ` TEMPLATE ${template}` : ''}`)
  if (hasTemplate) process.env.BAUHERR_TEST_SCHEMA_READY = '1'
  else delete process.env.BAUHERR_TEST_SCHEMA_READY
  return { url: withDb(base, name), drop: async (payload) => {
      (payload?.db as { pool?: pg.Pool } | undefined)?.pool?.on('error', () => {})
      await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {})
    },
  }
}
