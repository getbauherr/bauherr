import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
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

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const insert = async (slug: string, o: { processing?: boolean; updated?: number; completed?: number | null }) =>
  (await payload.db.drizzle.execute(sql`INSERT INTO "payload_jobs" ("task_slug", "processing", "updated_at", "created_at", "completed_at") VALUES (${slug}, ${o.processing ?? false}, ${minutesAgo(o.updated ?? 0)}, ${minutesAgo(o.updated ?? 0)}, ${o.completed == null ? null : minutesAgo(o.completed)}) RETURNING "id"`)).rows[0].id as number
const state = async (id: number) => (await payload.db.drizzle.execute(sql`SELECT "processing", "has_error" FROM "payload_jobs" WHERE "id" = ${id}`)).rows[0] as { processing: boolean; has_error: boolean }

it('reclaims only stale scheduled jobs, never run-stage', async () => {
  const stale = await insert('watch-release', { processing: true, updated: 61 })
  const fresh = await insert('watch-release', { processing: true, updated: 25 })
  const run = await insert('run-stage', { processing: true, updated: 120 })
  expect(await jobs.reclaimStaleJobs(payload)).toBe(1)
  expect(await state(stale)).toEqual({ processing: false, has_error: true })
  expect(await state(fresh)).toMatchObject({ processing: true })
  expect(await state(run)).toMatchObject({ processing: true })
})

it('maxAgeMs 0 (poller start) reclaims an orphaned scheduled job but never run-stage', async () => {
  const orphan = await insert('watch-production', { processing: true, updated: 0.02 })
  const run = await insert('run-stage', { processing: true, updated: 0.02 })
  const young = await insert('watch-release', { processing: true, updated: 10 })
  expect(await jobs.reclaimStaleJobs(payload)).toBe(0)
  expect(await jobs.reclaimStaleJobs(payload, Date.now(), 0)).toBeGreaterThanOrEqual(2)
  expect(await state(orphan)).toEqual({ processing: false, has_error: true })
  expect(await state(young)).toEqual({ processing: false, has_error: true })
  expect(await state(run)).toMatchObject({ processing: true })
})

it('a job in a legitimate forge back-off (3 x 300 s) is not reclaimed', async () => {
  const waiting = await insert('watch-reviews', { processing: true, updated: 16 })
  expect(await jobs.reclaimStaleJobs(payload)).toBe(0)
  expect(await state(waiting)).toMatchObject({ processing: true })
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "id" = ${waiting}`)
})

it('the two reclaimers reclaim each other, so neither can deadlock', async () => {
  const sessions = await insert('expire-sessions', { processing: true, updated: 90 })
  const reclaim = await insert('reclaim-jobs', { processing: true, updated: 90 })
  const run = await (jobs.reclaimJobs.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
  expect(run).toEqual({ output: { reclaimed: 2 } })
  expect(await state(sessions)).toEqual({ processing: false, has_error: true })
  expect(await state(reclaim)).toEqual({ processing: false, has_error: true })
  expect(jobs.scheduledSlugs()).not.toContain('run-stage')
})

it('splits the watchers into separate tasks with separate concurrency keys', async () => {
  const tasks = [jobs.watchReviewsTask, jobs.watchProductionTask, jobs.resumeReviewsTask, jobs.watchReleaseTask]
  const keys = tasks.map((t) => (t.concurrency as () => string)())
  expect(new Set(keys).size).toBe(4)
  expect(keys).toEqual(tasks.map((t) => t.slug))
  for (const t of tasks) expect(t.schedule).toHaveLength(1)
  for (const t of tasks) expect(jobs.scheduledSlugs()).toContain(t.slug)
  const run = (t: (typeof tasks)[number], p: unknown) => (t.handler as (a: unknown) => Promise<unknown>)({ req: { payload: p } })
  await expect(run(jobs.watchReviewsTask, {})).rejects.toThrow()
  await expect(run(jobs.watchReleaseTask, payload)).resolves.toMatchObject({ output: {} })
})

it('health: stale scheduled tasks are named, fresh ones and the startup grace are ok', async () => {
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  const fresh = Date.now()
  // startup grace: only a young job row exists
  await insert('poll-tickets', { updated: 1 })
  expect(await health.staleTasks(payload, fresh)).toEqual([])
  for (const s of jobs.scheduledSlugs().filter((s) => s !== 'watch-release')) await insert(s, { updated: 1, completed: 1 })
  await insert('watch-release', { updated: 6, completed: 6 })
  expect(await health.staleTasks(payload, fresh)).toEqual(['watch-release'])
  await insert('watch-release', { updated: 0, completed: 0 })
  expect(await health.staleTasks(payload, fresh)).toEqual([])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "task_slug" = 'notify-gates'`)
  // an hourly and a daily task are not stale between their runs, and are once a run was missed
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "task_slug" IN ('notify-gates', 'security-scan-tick', 'prune-comment-media')`)
  await insert('notify-gates', { updated: 1, completed: 1 })
  await insert('security-scan-tick', { updated: 50, completed: 50 })
  await insert('prune-comment-media', { updated: 20 * 60, completed: 20 * 60 })
  expect(await health.staleTasks(payload, fresh)).toEqual([])
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "task_slug" = 'security-scan-tick'`)
  await insert('security-scan-tick', { updated: 200, completed: 200 })
  expect(await health.staleTasks(payload, fresh)).toEqual(['security-scan-tick'])
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
  const hourly = jobs.scheduledTasks().find((t) => t.cron.split(' ')[1] === '0' && t.cron.split(' ')[2] === '*')!.slug
  // (a) a new hourly task right after a deploy: other tasks ran, it has no row
  for (const s of jobs.scheduledSlugs().filter((s) => s !== hourly)) await insert(s, { updated: 1, completed: 1 })
  expect(await health.staleTasks(payload, now)).toEqual([])
  // (b) same schedule, siblings completed twice, this one has no row
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs"`)
  for (const s of siblings) for (const m of [3, 1]) await insert(s, { updated: m, completed: m })
  expect(await health.staleTasks(payload, now)).toEqual([lonely])
  // one completion of the siblings is not enough
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "completed_at" < ${minutesAgo(2)}`)
  expect(await health.staleTasks(payload, now)).toEqual([])
  // (c) a row created 10 minutes ago, never completed, for an every-minute task
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
