import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('task_slugs', undefined, { blank: true })
  const url = testDb.url
  process.env.DATABASE_URL = url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  const { migrations } = await import('../src/migrations')
  const config = await (await import('../src/payload.config')).default
  payload = await getPayload({ config: { ...config, db: postgresAdapter({ pool: { connectionString: url }, push: false }) as never } })
  await payload.db.migrate({ migrations: migrations as never })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const tasks = () => payload.config.jobs.tasks!

it('every registered task slug is in both job enums', async () => {
  for (const type of ['enum_payload_jobs_task_slug', 'enum_payload_jobs_log_task_slug']) {
    const res = (await (payload.db as any).drizzle.execute(sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${type}`)) as { rows: { enumlabel: string }[] }
    const labels = new Set(res.rows.map((r) => r.enumlabel))
    expect(tasks().map((t) => t.slug).filter((s) => !labels.has(s)), type).toEqual([])
  }
})

it('scheduled tasks get a payload_jobs row within two ticks', async () => {
  await payload.jobs.handleSchedules({ queue: 'poll' })
  await payload.jobs.handleSchedules({ queue: 'poll' })
  const scheduled = tasks().filter((t) => t.schedule?.length).map((t) => t.slug)
  expect(scheduled.length).toBeGreaterThan(0)
  const { docs } = await payload.find({ collection: 'payload-jobs', limit: 0, pagination: false, overrideAccess: true })
  const have = new Set(docs.map((d) => d.taskSlug))
  expect(scheduled.filter((s) => !have.has(s))).toEqual([])
})

it('a failing schedule is logged with the task slug', async () => {
  const task = tasks().find((t) => t.schedule?.length)!
  const hook = (task.schedule![0] as any).hooks.afterSchedule
  const error = vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined as never)
  await hook({ defaultAfterSchedule: async () => {}, jobStats: null, queueable: { scheduleConfig: task.schedule![0], taskConfig: task }, req: { payload }, status: 'error', error: new Error('boom') })
  expect(error).toHaveBeenCalledTimes(1)
  expect(error.mock.calls[0][0]).toMatchObject({ task: task.slug })
  error.mockRestore()
})
