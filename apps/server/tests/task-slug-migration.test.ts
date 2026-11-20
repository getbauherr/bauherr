import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { bootBlankPayload, forPayload, runSql, type MigrationDb } from './helpers/migration-db'

let db: MigrationDb
let payload: Payload
beforeAll(async () => {
  db = await bootBlankPayload('task_slugs')
  payload = db.payload
  const { migrations } = await import('../src/migrations')
  await payload.db.migrate({ migrations: migrations.map(forPayload) })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

type ScheduleHook = (args: {
  defaultAfterSchedule: () => Promise<void>
  jobStats: null
  queueable: { scheduleConfig: unknown; taskConfig: unknown }
  req: { payload: Payload }
  status: 'error'
  error: Error
}) => Promise<void>

const taskSchema = z.object({
  slug: z.string(),
  schedule: z
    .array(
      z.object({
        hooks: z.object({ afterSchedule: z.custom<ScheduleHook>((v) => typeof v === 'function') }).optional(),
      }),
    )
    .optional(),
})

const rawTasks = () => payload.config.jobs.tasks ?? []
const tasks = () => z.array(taskSchema).parse(rawTasks())
const enumLabel = z.object({ enumlabel: z.string() })

it('every registered task slug is in both job enums', async () => {
  for (const type of ['enum_payload_jobs_task_slug', 'enum_payload_jobs_log_task_slug']) {
    const res = await runSql(
      payload,
      sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${type}`,
    )
    const labels = new Set(
      z
        .array(enumLabel)
        .parse(res.rows)
        .map((r) => r.enumlabel),
    )
    expect(
      tasks()
        .map((t) => t.slug)
        .filter((s) => !labels.has(s)),
      type,
    ).toEqual([])
  }
})

it('scheduled tasks get a payload_jobs row within two ticks', async () => {
  await payload.jobs.handleSchedules({ queue: 'poll' })
  await payload.jobs.handleSchedules({ queue: 'poll' })
  const scheduled = tasks()
    .filter((t) => t.schedule?.length)
    .map((t) => t.slug)
  expect(scheduled.length).toBeGreaterThan(0)
  const { docs } = await payload.find({ collection: 'payload-jobs', limit: 0, pagination: false, overrideAccess: true })
  const have = new Set(docs.map((d) => z.string().parse(d.taskSlug)))
  expect(scheduled.filter((s) => !have.has(s))).toEqual([])
})

it('a failing schedule is logged with the task slug', async () => {
  const task = rawTasks().find((t) => t.schedule?.length)!
  const hook = tasks().find((t) => t.slug === task.slug)!.schedule![0].hooks!.afterSchedule
  const error = vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined)
  await hook({
    defaultAfterSchedule: async () => {},
    jobStats: null,
    queueable: { scheduleConfig: task.schedule![0], taskConfig: task },
    req: { payload },
    status: 'error',
    error: new Error('boom'),
  })
  expect(error).toHaveBeenCalledTimes(1)
  const logged: unknown = error.mock.calls[0][0]
  expect(logged).toMatchObject({ task: z.string().parse(task.slug) })
  error.mockRestore()
})
