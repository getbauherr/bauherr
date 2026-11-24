import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { RECENT_PULLS } from './checks'

export const NOT_STARTED_AFTER_MS = 60 * 60_000

export type NotStartedCause = 'conflict' | 'ci-down' | 'no-workflow'

export type NotStarted = {
  recordId: number
  number: number
  product: number
  since: string
  waitedMinutes: number
  cause: NotStartedCause
  text: string
}

export type NotStartedFilter = { workspace: number; now: Date; product?: number; recordId?: number }

const count = z.coerce.number()
const waitingRow = z.object({
  id: count,
  number: count,
  product_id: count,
  since: z.coerce.date(),
  conflicts: z.boolean(),
  base_ref: z.string().nullable(),
})
const checksRow = z.object({ checks: z.array(z.string()) })

export const causeOf = (f: { conflicts: boolean; recentPulls: { checks: string[] }[] }): NotStartedCause => {
  if (f.conflicts) return 'conflict'
  return f.recentPulls.length > 0 && f.recentPulls.every((pull) => pull.checks.length === 0) ? 'ci-down' : 'no-workflow'
}

export const causeText = (cause: NotStartedCause, base: string | null): string => {
  if (cause === 'conflict') {
    return `The pull request conflicts with ${base ?? 'its base'}: a conflicting pull request gets no CI.`
  }
  if (cause === 'ci-down') {
    return `No workflow ran on the last ${RECENT_PULLS} pull requests either: CI is down or missing.`
  }
  return 'No workflow matched this change.'
}

export const recentPulls = async (payload: Payload, product: number): Promise<{ checks: string[] }[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT coalesce((SELECT jsonb_agg(DISTINCT c."name") FROM "mirror_checks" c WHERE c."item_id" = p."id"),
      '[]'::jsonb) AS checks
    FROM (
      SELECT i."id" FROM "mirror_items" i
      WHERE i."product_id" = ${product} AND i."kind" = 'pr' AND i."gone_at" IS NULL
      ORDER BY i."forge_created_at" DESC NULLS LAST, i."id" DESC LIMIT ${RECENT_PULLS}) p`)
  return found.rows.map((row) => checksRow.parse(row))
}

const waitingRows = async (payload: Payload, f: NotStartedFilter) => {
  const cutoff = new Date(f.now.getTime() - NOT_STARTED_AFTER_MS).toISOString()
  const found = await payload.db.drizzle.execute(sql`
    SELECT r."id", r."source_number" AS number, r."product_id", pe."created_at" AS since,
      (i."conflict_sha" IS NOT NULL AND i."conflict_sha" = i."head_sha") AS conflicts, i."base_ref"
    FROM "records" r
    JOIN "products" p ON p."id" = r."product_id" AND btrim(coalesce(p."required_checks", '')) <> ''
    JOIN LATERAL (
      SELECT e."created_at", e."data"->>'patchId' AS patch_id, e."data"->>'headSha' AS head_sha,
        (e."data"->>'pr')::integer AS pr
      FROM "events" e WHERE e."record_id" = r."id" AND e."type" IN ('build.submitted', 'pull.adopted')
      ORDER BY e."id" DESC LIMIT 1) pe ON true
    JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = pe.pr AND i."kind" = 'pr' AND i."state" = 'open' AND i."head_sha" = pe.head_sha
    WHERE r."workspace_id" = ${f.workspace} AND r."stage" = 'verify' AND r."waiting_on" <> 'nobody'
      AND r."parked" IS NULL AND pe."created_at" <= ${cutoff}::timestamptz
      ${f.product === undefined ? sql`` : sql`AND r."product_id" = ${f.product}`}
      ${f.recordId === undefined ? sql`` : sql`AND r."id" = ${f.recordId}`}
      AND NOT EXISTS (SELECT 1 FROM "mirror_checks" c WHERE c."item_id" = i."id" AND c."sha" = pe.head_sha)
      AND NOT EXISTS (SELECT 1 FROM "events" d WHERE d."record_id" = r."id" AND d."type" = 'checks.finished'
        AND d."data"->>'patchId' = pe.patch_id)
    ORDER BY pe."created_at", r."id"`)
  return found.rows.map((row) => waitingRow.parse(row))
}

export const loadNotStarted = async (payload: Payload, f: NotStartedFilter): Promise<NotStarted[]> => {
  const pulls = new Map<number, { checks: string[] }[]>()
  const result: NotStarted[] = []
  for (const row of await waitingRows(payload, f)) {
    if (!pulls.has(row.product_id)) pulls.set(row.product_id, await recentPulls(payload, row.product_id))
    const cause = causeOf({ conflicts: row.conflicts, recentPulls: pulls.get(row.product_id) ?? [] })
    result.push({
      recordId: row.id,
      number: row.number,
      product: row.product_id,
      since: row.since.toISOString(),
      waitedMinutes: Math.floor((f.now.getTime() - row.since.getTime()) / 60_000),
      cause,
      text: causeText(cause, row.base_ref),
    })
  }
  return result
}
