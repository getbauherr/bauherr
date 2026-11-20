import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { scheduledTasks } from '../jobs'

export const STALE_TASK_MS = 5 * 60_000
const MIN = 60_000

export const staleAfterMs = (cron: string): number => {
  const [, min = '*', hour = '*'] = cron.trim().split(/\s+/)
  if (/^\d+$/.test(hour)) return 26 * 60 * MIN
  if (/^\d+$/.test(min)) return 150 * MIN
  const step = /^\*\/(\d+)$/.exec(min)
  return step ? Math.max(STALE_TASK_MS, Number(step[1]) * 3 * MIN) : STALE_TASK_MS
}

export const staleTasks = async (payload: Payload, now = Date.now()): Promise<string[]> => {
  const rows = (
    await payload.db.drizzle.execute(
      sql`SELECT "task_slug"::text AS slug, max("completed_at") AS last, min("created_at") AS first,
        count("completed_at")::int AS done FROM "payload_jobs"
        WHERE "created_at" > now() - interval '2 days' GROUP BY "task_slug"`,
    )
  ).rows as { slug: string; last: Date | null; first: Date | null; done: number }[]
  const by = new Map(rows.map((r) => [r.slug, r]))
  const tasks = scheduledTasks()
  return tasks
    .filter((t) => {
      const r = by.get(t.slug)
      if (!r) return tasks.some((o) => o.cron === t.cron && (by.get(o.slug)?.done ?? 0) >= 2)
      const since = r.last ?? r.first
      return !!since && now - new Date(since).getTime() > staleAfterMs(t.cron)
    })
    .map((t) => t.slug)
}
