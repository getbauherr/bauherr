import { median } from './insights'
import type { RunCost, TicketData } from './time-load'

export const COST_ROWS = ['intake', 'brief', 'build', 'review', 'verify'] as const
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
