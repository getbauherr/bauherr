import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { parseEvent } from '../events'
import { ago, list, scope } from './sql'
import { timeOf, type TicketTime, type TimedEvent, type TimedRun } from './time-split'

const count = z.coerce.number()
const ACCEPTING = ['result.accepted', 'ticket.done-elsewhere']

export const ROLES = z.enum(['builder', 'reviewer', 'verifier'])

export type RunCost = {
  id: number
  stage: string
  role: z.infer<typeof ROLES>
  status: string
  costUsd: number | null
  costSource: string | null
  inputTokens: number | null
  outputTokens: number | null
  seconds: number
  claimed: boolean
  createdAt: Date
}

export type TicketData = {
  recordId: number
  productId: number
  number: number
  title: string
  time: TicketTime
  runs: RunCost[]
}

const recordRow = z.object({
  id: count,
  product_id: count,
  source_number: count,
  created_at: z.coerce.date(),
  title: z.string().nullable(),
})
const eventRow = z.object({ record_id: count, type: z.string(), data: z.unknown(), created_at: z.coerce.date() })
const nullable = count.nullable()
const runRow = z.object({
  id: count,
  record_id: count,
  stage: z.string(),
  role: ROLES,
  status: z.string(),
  cost_usd: nullable,
  cost_source: z.string().nullable(),
  input_tokens: nullable,
  output_tokens: nullable,
  created_at: z.coerce.date(),
  started_at: z.coerce.date().nullable(),
  finished_at: z.coerce.date().nullable(),
})

const ids = (values: number[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)

export const doneRecordIds = async (
  payload: Payload,
  filter: { workspace: number; product?: number; since: string },
): Promise<number[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT DISTINCT e."record_id" FROM "events" e JOIN "records" r ON r."id" = e."record_id"
    WHERE ${scope(filter.workspace, filter.product)} AND e."type" IN (${list(ACCEPTING)})
      AND e."created_at" >= ${filter.since}::timestamptz`)
  return found.rows.map((row) => count.parse(row.record_id))
}

const grouped = <T extends { record_id: number }>(rows: T[]): Map<number, T[]> => {
  const map = new Map<number, T[]>()
  for (const row of rows) map.set(row.record_id, [...(map.get(row.record_id) ?? []), row])
  return map
}

const runOf = (row: z.infer<typeof runRow>): RunCost => ({
  id: row.id,
  stage: row.stage,
  role: row.role,
  status: row.status,
  costUsd: row.cost_source === 'gateway' ? row.cost_usd : null,
  costSource: row.cost_source,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  seconds: row.started_at && row.finished_at ? (row.finished_at.getTime() - row.started_at.getTime()) / 1000 : 0,
  claimed: row.started_at !== null,
  createdAt: row.created_at,
})

export const loadTickets = async (payload: Payload, recordIds: number[], now: Date): Promise<TicketData[]> => {
  if (recordIds.length === 0) return []
  const db = payload.db.drizzle
  const records = (
    await db.execute(sql`
      SELECT r."id", r."product_id", r."source_number", r."created_at", i."title" FROM "records" r
      LEFT JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
        AND i."number" = r."source_number" AND i."kind" = 'issue'
      WHERE r."id" IN (${ids(recordIds)}) ORDER BY r."id"`)
  ).rows.map((row) => recordRow.parse(row))
  const events = grouped(
    (
      await db.execute(sql`
        SELECT "record_id", "type", "data", "created_at" FROM "events"
        WHERE "record_id" IN (${ids(recordIds)}) ORDER BY "id"`)
    ).rows.map((row) => eventRow.parse(row)),
  )
  const runs = grouped(
    (
      await db.execute(sql`
        SELECT "id", "record_id", "stage", "role", "status", "cost_usd", "cost_source", "input_tokens",
          "output_tokens", "created_at", "started_at", "finished_at" FROM "stage_runs"
        WHERE "record_id" IN (${ids(recordIds)}) ORDER BY "id"`)
    ).rows.map((row) => runRow.parse(row)),
  )
  return records.map((record) => {
    const timed: TimedEvent[] = (events.get(record.id) ?? []).map((row) => ({
      event: parseEvent({ type: row.type, data: row.data }),
      at: row.created_at,
    }))
    const rows = runs.get(record.id) ?? []
    const spans: TimedRun[] = rows.map((row) => ({
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }))
    const time = timeOf({ createdAt: record.created_at, events: timed, runs: spans, now })
    const title = record.title ?? `#${record.source_number}`
    return {
      recordId: record.id,
      productId: record.product_id,
      number: record.source_number,
      title,
      time,
      runs: rows.map(runOf),
    }
  })
}

export const doneTickets = async (
  payload: Payload,
  filter: { workspace: number; product?: number; now: Date; days: number },
): Promise<TicketData[]> => {
  const since = ago(filter.now, filter.days)
  const { workspace, product } = filter
  const found = await doneRecordIds(payload, { workspace, since, ...(product === undefined ? {} : { product }) })
  const tickets = await loadTickets(payload, found, filter.now)
  const from = Date.parse(since)
  return tickets.filter((ticket) => ticket.time.doneAt !== null && ticket.time.doneAt.getTime() >= from)
}
