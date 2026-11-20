import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { z } from 'zod'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')
const DEFAULT_BASE = 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'

export type TestDb = { url: string; drop: (payload?: { db: unknown }) => Promise<void> }

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
    return (await client.query<Record<string, unknown>>(sql, params)).rows
  } finally {
    await client.end()
  }
}

export const templateDbName = (suffix = dbSuffix()) => testDbName('template', suffix)

const runTemplateDbName = () => process.env.BAUHERR_TEST_TEMPLATE_DB ?? templateDbName()

export const buildTemplateDb = async (base = process.env.DATABASE_URL ?? DEFAULT_BASE) => {
  const name = runTemplateDbName()
  await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin(base, `CREATE DATABASE ${name}`)
  const saved = { ...process.env }
  Object.assign(process.env, {
    DATABASE_URL: withDb(base, name),
    PAYLOAD_SECRET: 'test-secret',
    ENCRYPTION_KEY: 'test-key',
  })
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  payload.db.pool.on('error', () => {})
  await payload.destroy()
  await admin(base, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`)
  process.env = saved
  return async () => void (await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))
}

const RUN_TAG = /_(\d+)_([0-9a-f]{4})$/
const UNTAGGED_MAX_IDLE = '6 hours'

export const defaultIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const databaseRow = z.object({ datname: z.string(), oid: z.string() })

const databasesWithPrefix = async (base: string) =>
  z
    .array(databaseRow)
    .parse(
      await admin(
        base,
        `SELECT datname, oid::text AS oid FROM pg_database WHERE starts_with(datname, 'bauherr_test_')`,
      ),
    )
const dropDatabase = (base: string, name: string) =>
  admin(base, `DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`)

export const dropRunTestDbs = async (
  runTag: string,
  base = process.env.DATABASE_URL ?? DEFAULT_BASE,
): Promise<void> => {
  for (const { datname } of await databasesWithPrefix(base))
    if (datname.endsWith(`_${runTag}`)) await dropDatabase(base, datname)
}

const mayStatFiles = async (base: string): Promise<boolean> => {
  const [row] = await admin(base, `SELECT has_function_privilege('pg_stat_file(text,boolean)', 'execute') AS may_stat`)
  return z.object({ may_stat: z.boolean() }).parse(row).may_stat
}

const hasConnections = async (base: string, name: string): Promise<boolean> => {
  const [row] = await admin(base, `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`, [name])
  return z.object({ n: z.number() }).parse(row).n > 0
}

const isIdleUntagged = async (base: string, oid: string): Promise<boolean> =>
  admin(
    base,
    `SELECT now() - (pg_stat_file('base/' || $1::text || '/PG_VERSION')).modification
      > interval '${UNTAGGED_MAX_IDLE}' AS idle`,
    [oid],
  ).then(
    (r) => z.object({ idle: z.boolean() }).parse(r[0]).idle,
    () => false,
  )

const isStaleUntagged = async (base: string, name: string, oid: string, mayStat: boolean): Promise<boolean> =>
  mayStat && !(await hasConnections(base, name)) && (await isIdleUntagged(base, oid))

const isStaleTagged = (tag: RegExpExecArray, ownTag: string | undefined, isAlive: (pid: number) => boolean) =>
  `${tag[1]}_${tag[2]}` !== ownTag && !isAlive(Number(tag[1]))

export const pruneStaleTestDbs = async (
  isAlive: (pid: number) => boolean = defaultIsAlive,
  base = process.env.DATABASE_URL ?? DEFAULT_BASE,
): Promise<string[]> => {
  const ownTag = RUN_TAG.exec(process.env.BAUHERR_TEST_TEMPLATE_DB ?? '')
    ?.slice(1)
    .join('_')
  const mayStat = await mayStatFiles(base)
  const dropped: string[] = []
  for (const { datname: name, oid } of await databasesWithPrefix(base)) {
    const tag = RUN_TAG.exec(name)
    const stale = tag ? isStaleTagged(tag, ownTag, isAlive) : await isStaleUntagged(base, name, oid, mayStat)
    if (!stale) continue
    await dropDatabase(base, name)
    dropped.push(name)
  }
  return dropped
}

export const createTestDb = async (
  suite: string,
  base = process.env.DATABASE_URL ?? DEFAULT_BASE,
  { blank = false } = {},
): Promise<TestDb> => {
  const name = testDbName(suite)
  const template = runTemplateDbName()
  const hasTemplate =
    !blank && (await admin(base, `SELECT 1 FROM pg_database WHERE datname = '${template}'`)).length > 0
  await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin(base, `CREATE DATABASE ${name}${hasTemplate ? ` TEMPLATE ${template}` : ''}`)
  if (hasTemplate) process.env.BAUHERR_TEST_SCHEMA_READY = '1'
  else delete process.env.BAUHERR_TEST_SCHEMA_READY
  return {
    url: withDb(base, name),
    drop: async (payload) => {
      ;(payload?.db as { pool?: pg.Pool } | undefined)?.pool?.on('error', () => {})
      await admin(base, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {})
    },
  }
}
