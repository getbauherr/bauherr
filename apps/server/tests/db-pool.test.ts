import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { poolOptions } from '../src/lib/db-pool'
import { createTestDb, type TestDb } from './helpers/test-db'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('db_pool_422')
})
afterAll(async () => {
  await testDb?.drop()
})

it('defaults to max 20, timeout 10 s, idle 30 s', () => {
  expect(poolOptions({})).toEqual({ max: 20, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 })
})

it('reads DATABASE_POOL_MAX and DATABASE_POOL_TIMEOUT_MS', () => {
  expect(poolOptions({ DATABASE_POOL_MAX: '5', DATABASE_POOL_TIMEOUT_MS: '2500' })).toMatchObject({ max: 5, connectionTimeoutMillis: 2500 })
})

it.each(['0', '-1', '1.5', 'ten'])('an invalid value (%s) throws at boot', (v) => {
  expect(() => poolOptions({ DATABASE_POOL_MAX: v })).toThrow(`DATABASE_POOL_MAX must be a positive integer, got "${v}"`)
  expect(() => poolOptions({ DATABASE_POOL_TIMEOUT_MS: v })).toThrow('DATABASE_POOL_TIMEOUT_MS must be a positive integer')
})

it('an exhausted pool rejects the next connect within 1 s instead of hanging', async () => {
  const pool = new pg.Pool({ connectionString: testDb.url, ...poolOptions({ DATABASE_POOL_MAX: '2', DATABASE_POOL_TIMEOUT_MS: '500' }) })
  try {
    const held = [await pool.connect(), await pool.connect()]
    const started = Date.now()
    await expect(pool.connect()).rejects.toThrow(/timeout/i)
    expect(Date.now() - started).toBeLessThan(1000)
    held.forEach((c) => c.release())
    const again = await pool.connect()
    again.release()
  } finally {
    await pool.end()
  }
})
