import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { SCHEDULED_SLUGS } from '../jobs'

export const STALE_TASK_MS = 5 * 60_000

/** Every-minute tasks whose last completion is older than STALE_TASK_MS. A task that never completed counts only once the oldest job row is that old (startup grace). */
export const staleTasks = async (payload: Payload, now = Date.now()): Promise<string[]> => {
  const slugs = SCHEDULED_SLUGS.filter((s) => s !== 'prune-request-logs')
  const rows = (
    await payload.db.drizzle.execute(
      sql`SELECT "task_slug"::text AS slug, max("completed_at") AS last, (SELECT min("created_at") FROM "payload_jobs") AS first FROM "payload_jobs" GROUP BY "task_slug"`,
    )
  ).rows as { slug: string; last: Date | null; first: Date | null }[]
  const first = rows.reduce<number>((m, r) => Math.min(m, r.first ? new Date(r.first).getTime() : now), now)
  const last = new Map(rows.map((r) => [r.slug, r.last ? new Date(r.last).getTime() : first]))
  return slugs.filter((s) => now - (last.get(s) ?? first) > STALE_TASK_MS)
}
