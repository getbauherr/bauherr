import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { queryRows, rowsSql, type Fragment, type RowFilter, type TicketRow } from './rows'
import { REQUEST_BUCKETS, type RequestFilter, type Viewer } from './request-status'

export type RequestCursor = { changedAt: string; id: number }
export type RequestPage = { rows: TicketRow[]; cursor: RequestCursor | null }

const ACCEPTED = sql`('result.accepted', 'production.approved', 'ticket.done-elsewhere')`

const BUCKET = sql`CASE WHEN q."waiting_on" <> 'nobody' OR q."parked" IS NOT NULL THEN 'open'
  WHEN q."terminal_type" IN ${ACCEPTED} THEN 'live' ELSE 'closed' END`

const mineOf = (viewer: Viewer): Fragment => {
  const logins = viewer.forgeLogins.map((login) => sql`${login}`)
  const ids = viewer.sentRecordIds.map((id) => sql`${id}`)
  return sql`(${logins.length ? sql`lower(q."reporter") IN (${sql.join(logins, sql`, `)})` : sql`false`}
    OR ${ids.length ? sql`q."id" IN (${sql.join(ids, sql`, `)})` : sql`false`})`
}

const countRow = z.object({ bucket: z.enum(REQUEST_BUCKETS), n: z.coerce.number(), mine: z.coerce.number() })

export const requestCounts = async (
  payload: Payload,
  filter: RowFilter,
  viewer: Viewer,
): Promise<Record<RequestFilter, number>> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT ${BUCKET} AS bucket, count(*) AS n, count(*) FILTER (WHERE ${mineOf(viewer)}) AS mine
    FROM (${rowsSql(filter)}) q GROUP BY 1`)
  const counts: Record<RequestFilter, number> = { open: 0, live: 0, closed: 0, mine: 0 }
  for (const row of result.rows.map((r) => countRow.parse(r))) {
    counts[row.bucket] = row.n
    counts.mine += row.mine
  }
  return counts
}

export const requestPage = async (
  payload: Payload,
  filter: RowFilter,
  input: { viewer: Viewer; show: RequestFilter; after: RequestCursor | null; limit: number },
): Promise<RequestPage> => {
  const shown = input.show === 'mine' ? mineOf(input.viewer) : sql`${BUCKET} = ${input.show}`
  const after = input.after
    ? sql`AND (q."changed_at", q."id") < (${input.after.changedAt}::timestamptz, ${input.after.id})`
    : sql``
  const rows = await queryRows(
    payload,
    sql`SELECT q.* FROM (${rowsSql(filter)}) q WHERE ${shown} ${after}
    ORDER BY q."changed_at" DESC, q."id" DESC LIMIT ${input.limit}`,
  )
  const last = rows.at(-1)
  return {
    rows,
    cursor: last && rows.length === input.limit ? { changedAt: last.changedAt.toISOString(), id: last.recordId } : null,
  }
}
