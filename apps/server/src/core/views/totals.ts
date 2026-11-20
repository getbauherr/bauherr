import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { RowFilter } from './rows'
import { ago, LIVE_SQL, scope, TERMINAL_LIST } from './sql'

export type Totals = {
  shippedLast7Days: number
  finishedLast7Days: number
  medianSecondsToAccept: number | null
  firstPassAcceptRate: number | null
  exceptionRate: number | null
  sentBackFromVerifyLast7Days: number
  sentBackFromShipLast7Days: number
}

const number = z.coerce.number().nullable()
const totalsRow = z.object({
  shipped: z.coerce.number(),
  finished: z.coerce.number(),
  median: number,
  first_pass: z.coerce.number(),
  accepted: z.coerce.number(),
  asked: z.coerce.number(),
  ended: z.coerce.number(),
  verify_back: z.coerce.number(),
  ship_back: z.coerce.number(),
})

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole)

export const loadTotals = async (payload: Payload, filter: RowFilter): Promise<Totals> => {
  const week = ago(filter.now, 7)
  const month = ago(filter.now, 30)
  const result = await payload.db.drizzle.execute(sql`
    WITH tickets AS (
      SELECT r."id", r."created_at", NOT ${LIVE_SQL} AS terminal,
        max(e."created_at") FILTER (WHERE e."type" = 'result.accepted') AS accepted_at,
        max(e."created_at") FILTER (WHERE e."type" IN (${TERMINAL_LIST})) AS ended_at,
        bool_or(e."type" = 'result.sent-back') AS sent_back,
        bool_or(e."type" = 'question.asked') AS asked,
        count(*) FILTER (WHERE e."type" = 'verify.changes' AND e."created_at" >= ${week}::timestamptz) AS verify_back,
        count(*) FILTER (WHERE e."type" = 'result.sent-back' AND e."created_at" >= ${week}::timestamptz) AS ship_back
      FROM "records" r JOIN "events" e ON e."record_id" = r."id"
      WHERE ${scope(filter.workspace, filter.product)} AND r."updated_at" >= ${month}::timestamptz
      GROUP BY r."id", r."created_at"
    )
    SELECT
      count(*) FILTER (WHERE terminal AND accepted_at IS NOT NULL AND ended_at >= ${week}::timestamptz) AS shipped,
      count(*) FILTER (WHERE terminal AND ended_at >= ${week}::timestamptz) AS finished,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM accepted_at - "created_at"))
        FILTER (WHERE accepted_at >= ${month}::timestamptz) AS median,
      count(*) FILTER (WHERE accepted_at >= ${month}::timestamptz AND NOT sent_back) AS first_pass,
      count(*) FILTER (WHERE accepted_at >= ${month}::timestamptz) AS accepted,
      count(*) FILTER (WHERE terminal AND ended_at >= ${month}::timestamptz AND asked) AS asked,
      count(*) FILTER (WHERE terminal AND ended_at >= ${month}::timestamptz) AS ended,
      coalesce(sum(verify_back), 0) AS verify_back,
      coalesce(sum(ship_back), 0) AS ship_back
    FROM tickets`)
  const row = totalsRow.parse(result.rows[0])
  return {
    shippedLast7Days: row.shipped,
    finishedLast7Days: row.finished,
    medianSecondsToAccept: row.median,
    firstPassAcceptRate: ratio(row.first_pass, row.accepted),
    exceptionRate: ratio(row.asked, row.ended),
    sentBackFromVerifyLast7Days: row.verify_back,
    sentBackFromShipLast7Days: row.ship_back,
  }
}
