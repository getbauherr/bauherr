import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
let jobs: typeof import('../src/jobs')
let health: typeof import('../src/lib/health')

beforeAll(async () => {
  testDb = await createTestDb('stale_jobs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  health = await import('../src/lib/health')
})

beforeEach(async () => {
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const insert = async (slug: string, o: { processing?: boolean; updated?: number; completed?: number | null }) =>
  (await payload.db.drizzle.execute(sql`INSERT INTO "payload_jobs" ("task_slug", "processing", "updated_at", "created_at", "completed_at") VALUES (${slug}, ${o.processing ?? false}, ${minutesAgo(o.updated ?? 0)}, ${minutesAgo(o.updated ?? 0)}, ${o.completed == null ? null : minutesAgo(o.completed)}) RETURNING "id"`)).rows[0].id as number
const state = async (id: number) => (await payload.db.drizzle.execute(sql`SELECT "processing", "has_error" FROM "payload_jobs" WHERE "id" = ${id}`)).rows[0] as { processing: boolean; has_error: boolean }

const slugs = (): string[] => jobs.scheduledTasks().map((t) => t.slug)

it('reclaims only jobs that stopped making progress', async () => {
  const stale = await insert('resync-knowledge', { processing: true, updated: 61 })
  const fresh = await insert('resync-knowledge', { processing: true, updated: 25 })
  expect(await jobs.reclaimStaleJobs(payload)).toBe(1)
  expect(await state(stale)).toEqual({ processing: false, has_error: true })
  expect(await state(fresh)).toMatchObject({ processing: true })
})

it('maxAgeMs 0 (poller start) reclaims an orphaned scheduled job', async () => {
  const orphan = await insert('watch-gateway', { processing: true, updated: 0.02 })
  const young = await insert('resync-knowledge', { processing: true, updated: 10 })
  expect(await jobs.reclaimStaleJobs(payload)).toBe(0)
  expect(await jobs.reclaimStaleJobs(payload, Date.now(), 0)).toBe(2)
  expect(await state(orphan)).toEqual({ processing: false, has_error: true })
  expect(await state(young)).toEqual({ processing: false, has_error: true })
})

it('the reclaim task reclaims a stale reclaim task, so it cannot deadlock', async () => {
  const reclaim = await insert('reclaim-jobs', { processing: true, updated: 90 })
  const run = await (jobs.reclaimJobs.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
  expect(run).toEqual({ output: { reclaimed: 1 } })
  expect(await state(reclaim)).toEqual({ processing: false, has_error: true })
})

it('health: stale scheduled tasks are named, fresh ones and the startup grace are ok', async () => {
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  const fresh = Date.now()
  await insert('resync-knowledge', { updated: 1 })
  expect(await health.staleTasks(payload, fresh)).toEqual([])
  for (const s of slugs().filter((s) => s !== 'resync-knowledge')) await insert(s, { updated: 1, completed: 1 })
  await insert('resync-knowledge', { updated: 6, completed: 6 })
  expect(await health.staleTasks(payload, fresh)).toEqual(['resync-knowledge'])
  await insert('resync-knowledge', { updated: 0, completed: 0 })
  expect(await health.staleTasks(payload, fresh)).toEqual([])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "task_slug" = 'refresh-prices'`)
  await insert('refresh-prices', { updated: 200, completed: 200 })
  expect(await health.staleTasks(payload, fresh)).toEqual(['refresh-prices'])
})

const sameCron = (): string[] => {
  const tasks = jobs.scheduledTasks()
  const cron = tasks.find((t) => tasks.filter((o) => o.cron === t.cron).length >= 3)!.cron
  return tasks.filter((t) => t.cron === cron).map((t) => t.slug)
}

it('health: a task without a row is stale only when its schedule demonstrably ran; a row that never completed counts from its own age', async () => {
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  const now = Date.now()
  const [lonely, ...siblings] = sameCron()
  const hourly = jobs.scheduledTasks().find((t) => /^\d+$/.test(t.cron.split(' ')[1]!) && t.cron.split(' ')[2] === '*')!.slug
  for (const s of slugs().filter((s) => s !== hourly)) await insert(s, { updated: 1, completed: 1 })
  expect(await health.staleTasks(payload, now)).toEqual([])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  for (const s of siblings) for (const m of [3, 1]) await insert(s, { updated: m, completed: m })
  expect(await health.staleTasks(payload, now)).toEqual([lonely])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "completed_at" < ${minutesAgo(2)}`)
  expect(await health.staleTasks(payload, now)).toEqual([])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  await insert(lonely, { updated: 10 })
  expect(await health.staleTasks(payload, now)).toEqual([lonely])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  await insert(lonely, { updated: 2 })
  expect(await health.staleTasks(payload, now)).toEqual([])
})

it('health: the allowed gap follows the schedule', () => {
  expect(health.staleAfterMs('0 * * * * *')).toBe(5 * 60_000)
  expect(health.staleAfterMs('0 */5 * * * *')).toBe(15 * 60_000)
  expect(health.staleAfterMs('0 0 * * * *')).toBe(150 * 60_000)
  expect(health.staleAfterMs('0 30 3 * * *')).toBe(26 * 3_600_000)
})
