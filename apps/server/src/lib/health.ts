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

/** Looks at the last two days of job rows only (payload_jobs is never pruned). A scheduled task is stale when its last completion is older than its schedule allows (`staleAfterMs`). A task that never completed counts only once the oldest job row is that old (startup grace). */
export const staleTasks = async (payload: Payload, now = Date.now()): Promise<string[]> => {
  const rows = (
    await payload.db.drizzle.execute(
      sql`SELECT "task_slug"::text AS slug, max("completed_at") AS last, min("created_at") AS first FROM "payload_jobs" WHERE "created_at" > now() - interval '2 days' GROUP BY "task_slug"`,
    )
  ).rows as { slug: string; last: Date | null; first: Date | null }[]
  const first = rows.reduce<number>((m, r) => Math.min(m, r.first ? new Date(r.first).getTime() : now), now)
  const last = new Map(rows.map((r) => [r.slug, r.last ? new Date(r.last).getTime() : first]))
  return scheduledTasks().filter((t) => now - (last.get(t.slug) ?? first) > staleAfterMs(t.cron)).map((t) => t.slug)
}
