import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { STATEMENT_KINDS } from '../statements'
import type { ProductFilter } from './product-settings'

export const UNUSED_DAYS = 60
export const CHECK_AFTER = 3
const DAY_MS = 86_400_000

export type StatementRecord = {
  id: number
  kind: (typeof STATEMENT_KINDS)[number]
  text: string
  ticket: number
  handed: number
  cameBack: number
  unused: boolean
  makeCheck: boolean
}

const count = z.coerce.number()

const recordRow = z.object({
  id: count,
  kind: z.enum(STATEMENT_KINDS),
  text: z.string(),
  created_at: z.coerce.date(),
  source_number: count,
  handed: count,
  came_back: count,
  last_handed: z.coerce.date().nullable(),
})

export const statementRecords = async (
  payload: Payload,
  f: ProductFilter,
  now: Date = new Date(),
): Promise<StatementRecord[]> => {
  const found = await payload.db.drizzle.execute(sql`
    WITH handed AS (
      SELECT r."id" AS run_id, r."record_id", r."created_at", ids.value::int AS statement_id,
        (SELECT e."type" FROM "stage_runs" v
          JOIN "events" e ON e."record_id" = v."record_id" AND e."data" ->> 'runId' = v."id"::text
            AND e."type" IN ('verify.passed', 'verify.changes')
          WHERE v."record_id" = r."record_id" AND v."stage" = 'verify' AND v."id" > r."id"
          ORDER BY v."id" LIMIT 1) AS outcome
      FROM "stage_runs" r
      JOIN "records" rec ON rec."id" = r."record_id"
      CROSS JOIN LATERAL jsonb_array_elements_text(r."context" -> 'statements') AS ids
      WHERE rec."product_id" = ${f.product} AND rec."workspace_id" = ${f.workspace})
    SELECT s."id", s."kind", s."text", s."created_at", rec."source_number",
      count(h.run_id) AS handed,
      count(h.run_id) FILTER (WHERE h.outcome = 'verify.changes') AS came_back,
      max(h."created_at") AS last_handed
    FROM "statements" s
    JOIN "records" rec ON rec."id" = s."record_id"
    LEFT JOIN handed h ON h.statement_id = s."id"
    WHERE s."product_id" = ${f.product} AND s."workspace_id" = ${f.workspace}
    GROUP BY s."id", rec."source_number" ORDER BY s."id"`)
  const cutoff = now.getTime() - UNUSED_DAYS * DAY_MS
  return found.rows.map((raw) => {
    const row = recordRow.parse(raw)
    const lastUse = row.last_handed ?? row.created_at
    return {
      id: row.id,
      kind: row.kind,
      text: row.text,
      ticket: row.source_number,
      handed: row.handed,
      cameBack: row.came_back,
      unused: lastUse.getTime() < cutoff,
      makeCheck: row.came_back >= CHECK_AFTER,
    }
  })
}
