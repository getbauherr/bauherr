import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stageSchema, type Stage } from '../events'
import type { RowFilter } from './rows'
import { ENTRY_TABLE, scope } from './sql'

const medianRow = z.object({ stage: stageSchema, median: z.coerce.number() })

export const loadMedians = async (payload: Payload, filter: RowFilter, since: string): Promise<Map<Stage, number>> => {
  const where = scope(filter.workspace, filter.product)
  const result = await payload.db.drizzle.execute(sql`
    WITH changes AS (
      SELECT e."record_id", e."id" AS ord, e."created_at" AS at, m."stage"
      FROM "events" e JOIN ${ENTRY_TABLE} ON m."type" = e."type" JOIN "records" r ON r."id" = e."record_id"
      WHERE ${where} AND r."updated_at" >= ${since}::timestamptz
      UNION ALL
      SELECT r."id", 0, r."created_at", 'intake' FROM "records" r
      WHERE ${where} AND r."updated_at" >= ${since}::timestamptz
    ), runs AS (
      SELECT *, lead("stage") OVER w AS next_stage FROM changes WINDOW w AS (PARTITION BY "record_id" ORDER BY ord)
    ), stays AS (
      SELECT "stage", at, lead(at) OVER (PARTITION BY "record_id" ORDER BY ord) AS left_at
      FROM runs WHERE next_stage IS DISTINCT FROM "stage"
    )
    SELECT "stage", percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - at)) AS median
    FROM stays WHERE left_at IS NOT NULL AND left_at >= ${since}::timestamptz AND "stage" <> 'done'
    GROUP BY "stage"`)
  return new Map(result.rows.map((row) => medianRow.parse(row)).map((row) => [row.stage, row.median]))
}
