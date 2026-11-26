import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { Stage } from '../events'
import { queryRows, ROW_ORDER, rowsSql, type RowFilter, type TicketRow } from './rows'
import { ago } from './sql'

export type LaneCursor = { rank: number; enteredAt: string; id: number }

const lanes = (filter: RowFilter) => sql`(
  SELECT b.*, CASE WHEN b."waiting_on" <> 'nobody' OR b."parked" IS NOT NULL THEN b."stage" ELSE 'done' END AS lane
  FROM (${rowsSql(filter)}) b) q`

export const loadLanes = (payload: Payload, filter: RowFilter, limit: number): Promise<TicketRow[]> =>
  queryRows(
    payload,
    sql`SELECT w.* FROM (
      SELECT q.*, row_number() OVER (PARTITION BY q.lane, q."parked" IS NOT NULL ORDER BY ${ROW_ORDER}) AS rn
      FROM ${lanes(filter)}
      WHERE q."parked" IS NOT NULL OR q.lane <> 'done' OR q."terminal_at" >= ${ago(filter.now, 7)}::timestamptz) w
    WHERE w."parked" IS NOT NULL OR w.rn <= ${limit}
    ORDER BY ${ROW_ORDER}`,
  )

export const loadLaneAfter = (
  payload: Payload,
  filter: RowFilter,
  input: { stage: Stage; after: LaneCursor; limit: number },
): Promise<TicketRow[]> => {
  const { rank, enteredAt, id } = input.after
  return queryRows(
    payload,
    sql`SELECT q.* FROM ${lanes(filter)}
    WHERE q."parked" IS NULL AND q.lane = ${input.stage}
      AND (q."rank", q."entered_at", q."id") > (${rank}, ${enteredAt}::timestamptz, ${id})
    ORDER BY ${ROW_ORDER} LIMIT ${input.limit}`,
  )
}
