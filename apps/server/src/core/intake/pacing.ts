import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { advance, type AdvanceDeps, type MayStartFn } from '../engine'

const DEFAULT_LIMIT = 5

const rowSchema = z.object({ open: z.coerce.number(), cap: z.coerce.number().nullable() })
const idSchema = z.object({ id: z.coerce.number() })

const OPEN_BRIEFS = sql`
  r."stage" = 'brief' AND (r."data"->'source'->>'backlog')::boolean
  AND (r."card"->>'card' = 'brief' OR EXISTS (
    SELECT 1 FROM "stage_runs" sr
    WHERE sr."record_id" = r."id" AND sr."stage" = 'brief' AND sr."status" IN ('queued', 'claimed')))`

export const pacing =
  (payload: Payload): MayStartFn =>
  async (stored, stage) => {
    if (stage !== 'brief' || !stored.record.source.backlog) return { ok: true }
    const found = await payload.db.drizzle.execute(sql`
      SELECT p."backlog_brief_limit" AS cap,
        (SELECT count(*) FROM "records" r WHERE r."product_id" = p."id" AND r."id" <> ${stored.id} AND ${OPEN_BRIEFS})
          AS open
      FROM "records" self JOIN "products" p ON p."id" = self."product_id" WHERE self."id" = ${stored.id}`)
    const row = rowSchema.parse(found.rows[0])
    const limit = row.cap ?? DEFAULT_LIMIT
    if (row.open < limit) return { ok: true }
    return { ok: false, reason: `${row.open} Brief cards of backlog tickets wait on the owner (limit ${limit})` }
  }

export const resumeParked = async (deps: AdvanceDeps, near: number | null): Promise<void> => {
  const result = await deps.payload.db.drizzle.execute(sql`
    SELECT DISTINCT ON (r."product_id") r."id" FROM "records" r
    WHERE r."parked" IS NOT NULL AND (${near}::integer IS NULL
      OR r."product_id" = (SELECT "product_id" FROM "records" WHERE "id" = ${near}))
    ORDER BY r."product_id", r."rank", r."id"`)
  for (const row of result.rows) await advance(idSchema.parse(row).id, deps)
}
