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

/** Drops and recreates `bauherr_test_<suite>[_<suffix>]`; `drop(payload)` silences the payload pool's errors from the forced disconnect and removes it (call after `payload.destroy()`). */
export const createTestDb = async (suite: string, base = process.env.DATABASE_URL ?? DEFAULT_BASE): Promise<TestDb> => {
  const name = testDbName(suite)
  const withDb = (db: string) => base.replace(/\/[^/]+$/, `/${db}`)
  const run = async (sql: string) => {
    const admin = new pg.Client({ connectionString: withDb('postgres') })
    await admin.connect()
    try {
      await admin.query(sql)
    } finally {
      await admin.end()
    }
  }
  await run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await run(`CREATE DATABASE ${name}`)
  return { url: withDb(name), drop: async (payload) => {
      (payload?.db as { pool?: pg.Pool } | undefined)?.pool?.on('error', () => {})
      await run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {})
    },
  }
}
