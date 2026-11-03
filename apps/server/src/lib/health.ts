import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { scheduledSlugs } from '../jobs'

export const STALE_TASK_MS = 5 * 60_000

/** Looks at the last day of job rows only (payload_jobs is never pruned). Every-minute tasks whose last completion is older than STALE_TASK_MS. A task that never completed counts only once the oldest job row is that old (startup grace). */
export const staleTasks = async (payload: Payload, now = Date.now()): Promise<string[]> => {
  const slugs = scheduledSlugs().filter((s) => s !== 'prune-request-logs')
  const rows = (
    await payload.db.drizzle.execute(
      sql`SELECT "task_slug"::text AS slug, max("completed_at") AS last, min("created_at") AS first FROM "payload_jobs" WHERE "created_at" > now() - interval '1 day' GROUP BY "task_slug"`,
    )
  ).rows as { slug: string; last: Date | null; first: Date | null }[]
  const first = rows.reduce<number>((m, r) => Math.min(m, r.first ? new Date(r.first).getTime() : now), now)
  const last = new Map(rows.map((r) => [r.slug, r.last ? new Date(r.last).getTime() : first]))
  return slugs.filter((s) => now - (last.get(s) ?? first) > STALE_TASK_MS)
}
