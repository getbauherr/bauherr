import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { median } from './insights'
import type { RunCost, TicketData } from './time-load'

export const COST_ROWS = ['intake', 'brief', 'build', 'review', 'verify', 'learn'] as const
export type CostKey = (typeof COST_ROWS)[number]

export type TicketCost = { costUsd: number | null; measured: number; runs: number }
export type CostRow = { key: CostKey; runs: number; measured: number; costUsd: number; perTicket: number | null }
export type TopTicket = TicketCost & {
  recordId: number
  number: number
  title: string
  verifyRounds: number
  leadSeconds: number
}

export type CostSummary = {
  rows: CostRow[]
  total: { runs: number; measured: number; costUsd: number; medianPerTicket: number | null }
  tickets: { all: number; measured: number }
  top: TopTicket[]
}

export const TOP = 3

export const keyOf = (run: Pick<RunCost, 'stage' | 'role'>): CostKey | null => {
  if (run.stage === 'verify') return run.role === 'reviewer' ? 'review' : 'verify'
  if (run.stage === 'done') return 'learn'
  return run.stage === 'intake' || run.stage === 'brief' || run.stage === 'build' ? run.stage : null
}

const worked = (runs: RunCost[]): RunCost[] => runs.filter((run) => run.claimed)

export const costOf = (runs: RunCost[]): TicketCost => {
  const claimed = worked(runs)
  const priced = claimed.filter((run) => run.costUsd !== null)
  const costUsd = priced.length === 0 ? null : priced.reduce((sum, run) => sum + (run.costUsd ?? 0), 0)
  return { costUsd, measured: priced.length, runs: claimed.length }
}

const rowOf = (key: CostKey, tickets: TicketData[]): CostRow => {
  const runs = tickets.map((ticket) => worked(ticket.runs).filter((run) => keyOf(run) === key))
  const costs = runs.map((entry) => costOf(entry))
  const withCost = costs.filter((entry) => entry.costUsd !== null)
  const costUsd = withCost.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0)
  return {
    key,
    runs: costs.reduce((sum, entry) => sum + entry.runs, 0),
    measured: costs.reduce((sum, entry) => sum + entry.measured, 0),
    costUsd,
    perTicket: withCost.length === 0 ? null : costUsd / withCost.length,
  }
}

export const summarizeCost = (tickets: TicketData[]): CostSummary => {
  const rows = COST_ROWS.map((key) => rowOf(key, tickets))
  const perTicket = tickets.map((ticket) => ({ ticket, cost: costOf(ticket.runs) }))
  const measured = perTicket.filter((entry) => entry.cost.costUsd !== null)
  const top = [...measured]
    .sort((a, b) => (b.cost.costUsd ?? 0) - (a.cost.costUsd ?? 0))
    .slice(0, TOP)
    .map(({ ticket, cost }) => ({
      ...cost,
      recordId: ticket.recordId,
      number: ticket.number,
      title: ticket.title,
      verifyRounds: ticket.time.verifyRounds,
      leadSeconds: ticket.time.seconds,
    }))
  return {
    rows,
    total: {
      runs: rows.reduce((sum, row) => sum + row.runs, 0),
      measured: rows.reduce((sum, row) => sum + row.measured, 0),
      costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
      medianPerTicket: median(measured.map((entry) => entry.cost.costUsd ?? 0)),
    },
    tickets: { all: tickets.length, measured: measured.length },
    top,
  }
}

export type ComingBack = { tickets: number; rounds: number; seconds: number } & TicketCost

const backRow = z.object({
  tickets: z.coerce.number(),
  rounds: z.coerce.number(),
  seconds: z.coerce.number(),
  cost: z.coerce.number().nullable(),
  runs: z.coerce.number(),
  measured: z.coerce.number(),
})

export const costOfComingBack = async (
  payload: Payload,
  where: { workspace: number; id: number },
): Promise<ComingBack | null> => {
  const found = await payload.db.drizzle.execute(sql`
    WITH fixes AS (
      SELECT DISTINCT (c.v->>'record')::int AS record_id FROM "statements" s
      CROSS JOIN LATERAL jsonb_array_elements(s."came_back") AS c(v)
      WHERE s."id" = ${where.id} AND s."workspace_id" = ${where.workspace}
    ), corrected AS (
      SELECT f.record_id, min(e."created_at") AS at FROM fixes f
      LEFT JOIN "events" e ON e."record_id" = f.record_id
        AND e."type" IN ('result.sent-back', 'brief.changes-requested')
      GROUP BY f.record_id
    )
    SELECT count(DISTINCT c.record_id) AS tickets, count(r."id") FILTER (WHERE r."stage" = 'build') AS rounds,
      coalesce(sum(extract(epoch FROM r."finished_at" - r."started_at")), 0) AS seconds,
      sum(r."cost_usd") FILTER (WHERE r."cost_source" = 'gateway') AS cost, count(r."id") AS runs,
      count(r."id") FILTER (WHERE r."cost_source" = 'gateway') AS measured
    FROM corrected c LEFT JOIN "stage_runs" r ON r."record_id" = c.record_id AND r."stage" IN ('build', 'verify')
      AND r."started_at" IS NOT NULL AND r."created_at" >= c.at`)
  const row = backRow.parse(found.rows[0])
  if (row.tickets === 0) return null
  return {
    tickets: row.tickets,
    rounds: row.rounds,
    seconds: row.seconds,
    costUsd: row.measured === 0 ? null : row.cost,
    measured: row.measured,
    runs: row.runs,
  }
}
