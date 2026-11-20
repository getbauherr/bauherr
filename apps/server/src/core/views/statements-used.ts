import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { loadStatements, type UsedStatement } from '../run/context'
import { contextSchema } from '../run/schema'
import { stageSchema } from '../events'
import type { StoredEvent } from '../record/store'

export type StatementsUsed = { brief: UsedStatement[]; result: UsedStatement[] }

const runRow = z.object({ stage: stageSchema, context: contextSchema, created_at: z.coerce.date() })

const unique = (lists: number[][]): number[] => [...new Set(lists.flat())]

export const statementsUsed = async (
  payload: Payload,
  recordId: number,
  events: StoredEvent[],
): Promise<StatementsUsed> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "stage", "context", "created_at" FROM "stage_runs"
    WHERE "record_id" = ${recordId} AND "context" IS NOT NULL ORDER BY "id"`)
  const runs = found.rows.map((row) => runRow.parse(row))
  const approved = events.findLast((event) => event.type === 'brief.approved')
  const since = approved ? Date.parse(approved.createdAt) : null
  const brief = runs.findLast((run) => run.stage === 'brief')
  const built = runs.filter(
    (run) => (run.stage === 'build' || run.stage === 'verify') && since !== null && run.created_at.getTime() >= since,
  )
  return {
    brief: await loadStatements(payload, unique(brief ? [brief.context.statements] : [])),
    result: await loadStatements(payload, unique(built.map((run) => run.context.statements))),
  }
}
