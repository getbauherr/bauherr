import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { scheduledTasks } from '../jobs'

export const STALE_TASK_MS = 5 * 60_000
const MIN = 60_000

/**
 * How long a task may go without a completion before it counts as stale, read from its cron line (seconds, minutes, hours, …):
 * every minute 5 min, every n minutes 3 runs, hourly 2.5 h, daily 26 h. A fixed 5 minutes named every hourly and daily task stale between its runs.
 */
export const staleAfterMs = (cron: string): number => {
  const [, min = '*', hour = '*'] = cron.trim().split(/\s+/)
  if (/^\d+$/.test(hour)) return 26 * 60 * MIN
  if (/^\d+$/.test(min)) return 150 * MIN
  const step = /^\*\/(\d+)$/.exec(min)
  return step ? Math.max(STALE_TASK_MS, Number(step[1]) * 3 * MIN) : STALE_TASK_MS
}

/**
 * Looks at the last two days of job rows only (payload_jobs is never pruned). A scheduled task is stale when
 * - it completed in the window, and the last completion is older than its schedule allows (`staleAfterMs`);
 * - it has rows but none completed (queued or running), and its oldest row is older than that;
 * - it has no row at all, and another task with the same cron line completed at least twice in the window (the schedule demonstrably ran, this task did not).
 * A task with no row otherwise counts as not stale: it is new (just deployed) or the instance just started.
 */
export const staleTasks = async (payload: Payload, now = Date.now()): Promise<string[]> => {
  const rows = (
    await payload.db.drizzle.execute(
      sql`SELECT "task_slug"::text AS slug, max("completed_at") AS last, min("created_at") AS first, count("completed_at")::int AS done FROM "payload_jobs" WHERE "created_at" > now() - interval '2 days' GROUP BY "task_slug"`,
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
