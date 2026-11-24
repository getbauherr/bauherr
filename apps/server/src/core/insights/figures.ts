import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { median } from '../views/insights'
import { list, scope } from '../views/sql'
import { previousRange, type Range } from './range'

export const AXES = ['spec', 'standards', 'security'] as const
export type Axis = (typeof AXES)[number]

export const FIGURE_KEYS = [
  'ticketsAccepted',
  'firstTryShare',
  'sendBacks',
  'verifyRoundsPerTicket',
  'failedRuns',
  'questions',
  'secondsToAccepted',
  'costUsd',
  'findingsSpec',
  'findingsStandards',
  'findingsSecurity',
] as const
export type FigureKey = (typeof FIGURE_KEYS)[number]
export type Figures = Record<FigureKey, number | null>
export type Figure = { value: number | null; previous: number | null }

export type TicketFacts = {
  recordId: number
  doneAt: Date
  sendBacks: number
  verifyRounds: number
  failedRuns: number
  questions: number
  seconds: number
  costUsd: number
  findings: Record<Axis, number>
}

export type FigureFilter = { workspace: number; product?: number | undefined; range: Range }
export type RangeFigures = { range: Range; tickets: TicketFacts[]; figures: Record<FigureKey, Figure> }

type Ev = { type: string; at: Date }
type Run = { status: string; costUsd: number | null }

const ACCEPTING = ['result.accepted', 'ticket.done-elsewhere']
const id = z.coerce.number()
const eventRow = z.object({ record_id: id, type: z.string(), created_at: z.coerce.date() })
const runRow = z.object({
  record_id: id,
  status: z.string(),
  cost_usd: id.nullable(),
  cost_source: z.string().nullable(),
})
const findingRow = z.object({ record_id: id, findings: z.array(z.object({ axis: z.enum(AXES) })).nullable() })

const count = (events: Ev[], type: string): number => events.filter((event) => event.type === type).length

export const acceptedAt = (events: Ev[]): Date | null => {
  const accepted = events.findLastIndex((event) => ACCEPTING.includes(event.type))
  if (accepted < 0 || events.slice(accepted + 1).some((event) => event.type === 'result.sent-back')) return null
  const closing = events.findLast((event) => event.type === 'ticket.closed' || event.type === 'ticket.restored')
  return closing?.type === 'ticket.closed' ? null : (events[accepted]?.at ?? null)
}

const briefStart = (events: Ev[]): Date | undefined =>
  (events.find((event) => event.type === 'intake.accepted') ?? events[0])?.at

const groupBy = <T extends { record_id: number }>(rows: T[]): Map<number, T[]> => {
  const map = new Map<number, T[]>()
  for (const row of rows) map.set(row.record_id, [...(map.get(row.record_id) ?? []), row])
  return map
}

const ticketOf = (recordId: number, events: Ev[], runs: Run[], axes: Axis[]): TicketFacts | null => {
  const doneAt = acceptedAt(events)
  const start = briefStart(events)
  if (doneAt === null || start === undefined) return null
  return {
    recordId,
    doneAt,
    sendBacks: count(events, 'result.sent-back'),
    verifyRounds: count(events, 'verify.changes'),
    failedRuns: runs.filter((run) => run.status === 'failed').length,
    questions: count(events, 'question.asked'),
    seconds: Math.max(0, (doneAt.getTime() - start.getTime()) / 1000),
    costUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
    findings: {
      spec: axes.filter((axis) => axis === 'spec').length,
      standards: axes.filter((axis) => axis === 'standards').length,
      security: axes.filter((axis) => axis === 'security').length,
    },
  }
}

export const loadTickets = async (payload: Payload, filter: FigureFilter): Promise<TicketFacts[]> => {
  const db = payload.db.drizzle
  const { from, to } = filter.range
  const accepted = sql`SELECT e."record_id" FROM "events" e JOIN "records" r ON r."id" = e."record_id"
    WHERE ${scope(filter.workspace, filter.product)} AND e."type" IN (${list(ACCEPTING)})
      AND e."created_at" >= ${from.toISOString()}::timestamptz AND e."created_at" < ${to.toISOString()}::timestamptz`
  const events = groupBy(
    (
      await db.execute(sql`SELECT "record_id", "type", "created_at" FROM "events"
        WHERE "record_id" IN (${accepted}) ORDER BY "id"`)
    ).rows.map((row) => eventRow.parse(row)),
  )
  const runs = groupBy(
    (
      await db.execute(sql`SELECT "record_id", "status", "cost_usd", "cost_source" FROM "stage_runs"
        WHERE "record_id" IN (${accepted})`)
    ).rows.map((row) => runRow.parse(row)),
  )
  const findings = (
    await db.execute(sql`SELECT "id" AS "record_id", "data"->'findings' AS "findings" FROM "records"
      WHERE "id" IN (${accepted})`)
  ).rows.map((row) => findingRow.parse(row))
  const tickets: TicketFacts[] = []
  for (const row of findings) {
    const own = (events.get(row.record_id) ?? []).map((event) => ({ type: event.type, at: event.created_at }))
    const measured = (runs.get(row.record_id) ?? []).map((run) => ({
      status: run.status,
      costUsd: run.cost_source === 'gateway' ? run.cost_usd : null,
    }))
    const ticket = ticketOf(row.record_id, own, measured, (row.findings ?? []).map((finding) => finding.axis))
    if (ticket && ticket.doneAt >= from && ticket.doneAt < to) tickets.push(ticket)
  }
  return tickets.sort((a, b) => a.recordId - b.recordId)
}

const sum = (tickets: TicketFacts[], pick: (ticket: TicketFacts) => number): number =>
  tickets.reduce((total, ticket) => total + pick(ticket), 0)

export const figuresOf = (tickets: TicketFacts[]): Figures => {
  const n = tickets.length
  const mean = (pick: (ticket: TicketFacts) => number) => (n === 0 ? null : sum(tickets, pick) / n)
  return {
    ticketsAccepted: n,
    firstTryShare: mean((ticket) => (ticket.sendBacks === 0 ? 1 : 0)),
    sendBacks: sum(tickets, (ticket) => ticket.sendBacks),
    verifyRoundsPerTicket: mean((ticket) => ticket.verifyRounds),
    failedRuns: sum(tickets, (ticket) => ticket.failedRuns),
    questions: sum(tickets, (ticket) => ticket.questions),
    secondsToAccepted: median(tickets.map((ticket) => ticket.seconds)),
    costUsd: sum(tickets, (ticket) => ticket.costUsd),
    findingsSpec: sum(tickets, (ticket) => ticket.findings.spec),
    findingsStandards: sum(tickets, (ticket) => ticket.findings.standards),
    findingsSecurity: sum(tickets, (ticket) => ticket.findings.security),
  }
}

export const rangeFigures = async (payload: Payload, filter: FigureFilter): Promise<RangeFigures> => {
  const tickets = await loadTickets(payload, filter)
  const before = await loadTickets(payload, { ...filter, range: previousRange(filter.range) })
  const value = figuresOf(tickets)
  const previous = figuresOf(before)
  const figures = Object.fromEntries(
    FIGURE_KEYS.map((key) => [key, { value: value[key], previous: before.length === 0 ? null : previous[key] }]),
  ) as Record<FigureKey, Figure>
  return { range: filter.range, tickets, figures }
}
