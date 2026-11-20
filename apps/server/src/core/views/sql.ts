import { sql } from '@payloadcms/db-postgres'
import type { EventType, Stage } from '../events'
import { STUCK_REASONS } from './status'

export const STAGE_ENTRY: Partial<Record<EventType, Stage>> = {
  'intake.accepted': 'brief',
  'brief.approved': 'build',
  'build.submitted': 'verify',
  'verify.passed': 'ship',
  'verify.overridden': 'ship',
  'verify.changes': 'build',
  'result.sent-back': 'build',
  'result.accepted': 'done',
  'production.approved': 'done',
  'ticket.closed': 'done',
  'intake.closed': 'done',
  'brief.discarded': 'done',
}

export const TERMINAL_EVENTS: EventType[] = [
  'result.accepted',
  'production.approved',
  'ticket.closed',
  'intake.closed',
  'brief.discarded',
]

export const DAY_MS = 86_400_000

export const list = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)

export const ENTRY_TABLE = sql`(VALUES ${sql.join(
  Object.entries(STAGE_ENTRY).map(([type, stage]) => sql`(${type}::text, ${stage}::text)`),
  sql`, `,
)}) AS m("type", "stage")`

export const TERMINAL_LIST = list(TERMINAL_EVENTS)
export const STUCK_SQL = sql`coalesce(r."card"->>'card' = 'question'
  AND r."card"->>'reason' IN (${list(STUCK_REASONS)}), false)`
export const LIVE_SQL = sql`(r."waiting_on" <> 'nobody' OR r."parked" IS NOT NULL)`
export const LIVE_RUN_SQL = sql`s."record_id" = r."id" AND s."status" IN ('queued', 'claimed')`

export const scope = (workspace: number, product: number | undefined) =>
  sql`r."workspace_id" = ${workspace} ${product === undefined ? sql`` : sql`AND r."product_id" = ${product}`}`

export const ago = (now: Date, days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString()
