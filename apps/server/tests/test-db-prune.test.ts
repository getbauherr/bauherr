import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import { pruneStaleTestDbs } from './helpers/test-db'

const base = (process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr').replace(/\/[^/]+$/, '/postgres')
const admin = async (sql: string, params: unknown[] = []) => {
  const client = new pg.Client({ connectionString: base })
  await client.connect()
  try {
    return (await client.query(sql, params)).rows
  } finally {
    await client.end()
  }
}
const exists = async (name: string) => (await admin('SELECT 1 FROM pg_database WHERE datname = $1', [name])).length > 0
const dropIfExists = (name: string) => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)

const ownTag = process.env.BAUHERR_TEST_TEMPLATE_DB?.replace(/^bauherr_test_template_/, '')
const ownPid = ownTag ? Number(ownTag.split('_')[0]) : -1
const deadPid = process.pid + 1_000_000
const dead = `bauherr_test_zz_${deadPid}_dead`
const live = `bauherr_test_zz_${process.pid}_beef`
// Names carry this process's pid or a random part: concurrent runs in one worktree must not share fixtures.
const untagged = `bauherr_test_zz_untagged_${randomBytes(2).toString('hex')}`
const other = `bauherr_e2e_zz_${process.pid}`
const own = ownTag ? `bauherr_test_zz_${ownTag}` : null
const created = [dead, live, untagged, other, ...(own ? [own] : [])]

afterAll(async () => {
  for (const name of created) await dropIfExists(name)
})

it('prunes runs whose pid is gone and idle untagged databases; keeps live runs, recent databases and other names', async () => {
  for (const name of created) {
    await dropIfExists(name)
    await admin(`CREATE DATABASE "${name}"`)
  }
  // Only the fake dead pid is gone, and this run's own pid counts as dead: the own-run rule must still keep its database.
  const isAlive = (pid: number) => pid !== deadPid && pid !== ownPid
  await pruneStaleTestDbs(isAlive)
  expect(await exists(dead)).toBe(false)
  expect(await exists(live)).toBe(true)
  expect(await exists(untagged)).toBe(true)
  expect(await exists(other)).toBe(true)
  if (own) expect(await exists(own)).toBe(true)
})
