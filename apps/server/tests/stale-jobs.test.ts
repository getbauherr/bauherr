import { sql } from '@payloadcms/db-postgres'
import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let jobs: typeof import('../src/jobs')
let health: typeof import('../src/lib/health')

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_stale_jobs WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_stale_jobs')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_stale_jobs')
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
})

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const insert = async (slug: string, o: { processing?: boolean; updated?: number; completed?: number | null }) =>
  (await payload.db.drizzle.execute(sql`INSERT INTO "payload_jobs" ("task_slug", "processing", "updated_at", "created_at", "completed_at") VALUES (${slug}, ${o.processing ?? false}, ${minutesAgo(o.updated ?? 0)}, ${minutesAgo(o.updated ?? 0)}, ${o.completed == null ? null : minutesAgo(o.completed)}) RETURNING "id"`)).rows[0].id as number
const state = async (id: number) => (await payload.db.drizzle.execute(sql`SELECT "processing", "has_error" FROM "payload_jobs" WHERE "id" = ${id}`)).rows[0] as { processing: boolean; has_error: boolean }

it('reclaims only stale scheduled jobs, never run-stage', async () => {
  const stale = await insert('watch-release', { processing: true, updated: 11 })
  const fresh = await insert('watch-release', { processing: true, updated: 2 })
  const run = await insert('run-stage', { processing: true, updated: 120 })
  expect(await jobs.reclaimStaleJobs(payload)).toBe(1)
  expect(await state(stale)).toEqual({ processing: false, has_error: true })
  expect(await state(fresh)).toMatchObject({ processing: true })
  expect(await state(run)).toMatchObject({ processing: true })
})

it('splits the watchers into separate tasks with separate concurrency keys', async () => {
  const tasks = [jobs.watchReviewsTask, jobs.watchProductionTask, jobs.resumeReviewsTask, jobs.watchReleaseTask]
  const keys = tasks.map((t) => (t.concurrency as () => string)())
  expect(new Set(keys).size).toBe(4)
  expect(keys).toEqual(tasks.map((t) => t.slug))
  for (const t of tasks) expect(jobs.SCHEDULED_SLUGS).toContain(t.slug)
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
  for (const s of jobs.SCHEDULED_SLUGS.filter((s) => s !== 'prune-request-logs' && s !== 'watch-release')) await insert(s, { updated: 1, completed: 1 })
  await insert('watch-release', { updated: 6, completed: 6 })
  expect(await health.staleTasks(payload, fresh)).toEqual(['watch-release'])
  await insert('watch-release', { updated: 0, completed: 0 })
  expect(await health.staleTasks(payload, fresh)).toEqual([])
  // never completed, but the oldest job row is older than the threshold
  await payload.db.drizzle.execute(sql`DELETE FROM "payload_jobs" WHERE "task_slug" = 'notify-gates'`)
  await insert('poll-tickets', { updated: 30 })
  expect(await health.staleTasks(payload, fresh)).toEqual(['notify-gates'])
})
