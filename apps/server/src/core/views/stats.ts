import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { STAGES, stageSchema, type Stage } from '../events'
import { WAITING_ON } from '../record/store'
import type { RowFilter } from './rows'
import { loadMedians } from './stays'
import { ago, LIVE_RUN_SQL, scope, STUCK_SQL } from './sql'
import { loadTotals, type Totals } from './totals'
import { STATES, stateOf, type TicketState } from './status'

export type LiveRunView = {
  recordId: number
  role: 'builder' | 'reviewer' | 'verifier'
  leasedBy: string | null
  status: 'queued' | 'claimed'
}

export type StageStat = {
  stage: Stage
  counts: Record<(typeof STATES)[number], number>
  total: number
  medianSeconds: number | null
  runs: LiveRunView[]
}

export type Stats = { stages: StageStat[]; totals: Totals }

const count = z.coerce.number()

const countRow = z.object({
  stage: stageSchema,
  waiting_on: z.enum(WAITING_ON),
  stuck: z.boolean(),
  has_run: z.boolean(),
  n: count,
})

const runRow = z.object({
  stage: stageSchema,
  record_id: count,
  role: z.enum(['builder', 'reviewer', 'verifier']),
  leased_by: z.string().nullable(),
  status: z.enum(['queued', 'claimed']),
})

const loadCounts = async (payload: Payload, filter: RowFilter) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."stage", r."waiting_on", ${STUCK_SQL} AS stuck, (s."id" IS NOT NULL) AS has_run, count(*) AS n
    FROM "records" r LEFT JOIN "stage_runs" s ON ${LIVE_RUN_SQL}
    WHERE ${scope(filter.workspace, filter.product)} AND r."waiting_on" <> 'nobody' AND r."parked" IS NULL
    GROUP BY 1, 2, 3, 4`)
  return result.rows.map((row) => countRow.parse(row))
}

const loadRuns = async (payload: Payload, filter: RowFilter) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."stage", s."record_id", s."role", s."leased_by", s."status"
    FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id"
    WHERE ${scope(filter.workspace, filter.product)} AND s."status" IN ('queued', 'claimed')
    ORDER BY s."id"`)
  return result.rows.map((row) => runRow.parse(row))
}

const emptyCounts = (): Record<(typeof STATES)[number], number> => ({ owner: 0, agents: 0, stuck: 0, others: 0 })

export const stageStats = async (payload: Payload, filter: RowFilter): Promise<Stats> => {
  const [counts, runs, medians, totals] = [
    await loadCounts(payload, filter),
    await loadRuns(payload, filter),
    await loadMedians(payload, filter, ago(filter.now, 30)),
    await loadTotals(payload, filter),
  ]
  const stages = STAGES.map((stage): StageStat => {
    const tally = emptyCounts()
    for (const row of counts.filter((c) => c.stage === stage)) {
      const state: TicketState = stateOf({ waitingOn: row.waiting_on, stuck: row.stuck, hasRun: row.has_run })
      if (state !== 'none') tally[state] += row.n
    }
    const total = stage === 'done' ? totals.finishedLast7Days : STATES.reduce((sum, s) => sum + tally[s], 0)
    return {
      stage,
      counts: tally,
      total,
      medianSeconds: medians.get(stage) ?? null,
      runs: runs
        .filter((run) => run.stage === stage)
        .map((run) => ({ recordId: run.record_id, role: run.role, leasedBy: run.leased_by, status: run.status })),
    }
  })
  return { stages, totals }
}
