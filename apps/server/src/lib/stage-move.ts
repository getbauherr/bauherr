import { setStage, stageOf as labelStage, type TicketSource } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { record } from './history'
import { workflowFor } from './factory'
import { board, isForward as forward, type Workflow } from './workflow'

const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as { id: number }).id : (v as number))

export const isForward = (wf: Workflow, from: string, to: string) => forward(wf, from, to)

export const stageOf = (wf: Workflow, labels: string[]) => {
  const names = [...board(wf), ...Object.keys(wf.aliases)]
  const found = labelStage(labels, names)
  return found && (wf.aliases[found] ?? found)
}

export const moveStage = async (payload: Payload, ts: TicketSource, t: Record<string, any>, name: string, why = ''): Promise<void> => {
  const row = (await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "factory_stage" = ${name}, "stage_since" = CASE WHEN "factory_stage" IS DISTINCT FROM ${name} THEN now() ELSE "stage_since" END WHERE "product_id" = ${idOf(t.product)} AND "number" = ${t.number} RETURNING "id"`)).rows[0] as { id: number } | undefined
  await setStage(ts, String(t.number), name)
  if (row) await record(payload, row.id, { stage: name, cause: why ? `moveStage:${why}` : 'moveStage' })
}
