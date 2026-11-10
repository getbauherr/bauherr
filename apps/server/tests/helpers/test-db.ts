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
const admin = async (base: string, sql: string, params: unknown[] = []) => {
  const client = new pg.Client({ connectionString: withDb(base, 'postgres') })
  await client.connect()
  try {
    return (await client.query(sql, params)).rows
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

/** Tag of a run's databases: `<pid>_<4 hex>`, the end of `bauherr_test_template_<tag>` and `bauherr_test_<suite>_<tag>`. */
const RUN_TAG = /_(\d+)_([0-9a-f]{4})$/
const UNTAGGED_MAX_IDLE = '6 hours'

/** Whether a pid is alive on this host: only ESRCH means gone; success or any other error (EPERM) means alive. */
export const defaultIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const databasesWithPrefix = async (base: string) => (await admin(base, `SELECT datname, oid::text AS oid FROM pg_database WHERE starts_with(datname, 'bauherr_test_')`)) as { datname: string; oid: string }[]
const dropDatabase = (base: string, name: string) => admin(base, `DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`)

/** Drops the `bauherr_test_*` databases of the run with this tag (template and suites), e.g. at teardown. */
export const dropRunTestDbs = async (runTag: string, base = process.env.DATABASE_URL ?? DEFAULT_BASE): Promise<void> => {
  for (const { datname } of await databasesWithPrefix(base)) if (datname.endsWith(`_${runTag}`)) await dropDatabase(base, datname)
}

/** Drops leftovers of runs that died: a tagged `bauherr_test_*` database whose pid is gone (`isAlive` false); an untagged one with no connection, older than 6 hours (needs `pg_stat_file`: superuser; otherwise untagged databases are kept). Never this run's own, never another name. Returns the dropped names. */
export const pruneStaleTestDbs = async (isAlive: (pid: number) => boolean = defaultIsAlive, base = process.env.DATABASE_URL ?? DEFAULT_BASE): Promise<string[]> => {
  const ownTag = RUN_TAG.exec(process.env.BAUHERR_TEST_TEMPLATE_DB ?? '')?.slice(1).join('_')
  const [{ may_stat }] = await admin(base, `SELECT has_function_privilege('pg_stat_file(text,boolean)', 'execute') AS may_stat`)
  const dropped: string[] = []
  for (const { datname: name, oid } of await databasesWithPrefix(base)) {
    const tag = RUN_TAG.exec(name)
    if (tag) {
      if (`${tag[1]}_${tag[2]}` === ownTag || isAlive(Number(tag[1]))) continue
    } else {
      if (!may_stat || (await admin(base, `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`, [name]))[0].n > 0) continue
      const idle = await admin(base, `SELECT now() - (pg_stat_file('base/' || $1::text || '/PG_VERSION')).modification > interval '${UNTAGGED_MAX_IDLE}' AS idle`, [oid]).then((r) => r[0].idle as boolean, () => false)
      if (!idle) continue
    }
    await dropDatabase(base, name)
    dropped.push(name)
  }
  return dropped
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
