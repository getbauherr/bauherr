import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { advance } from './advance'
import { sourceOf } from './actions'
import { workflowFor } from './factory'
import { record } from './history'
import { finishJob } from './stage-jobs'
import { jobOf, stage as stageDef } from './workflow'

type Doc = Record<string, any>

export const MAX_STAGE_COMMENT = 60_000
export const stageMarker = (name: string) => `<!-- bauherr:stage:${name} -->`

export const outcomesOf = (run: Doc): string[] => ((d) => (d && jobOf(d, run)?.outcomeOrder) ?? [])(stageDef(workflowFor(run.workspace), run.stage))

export const assertOutcome = (run: Doc, outcome: unknown): string => {
  const keys = outcomesOf(run)
  if (typeof outcome !== 'string' || !keys.includes(outcome)) throw new Error(`outcome must be one of ${keys.join(', ')}`)
  return outcome
}

export const finishAgentRun = async (payload: Payload, run: Doc, ticket: Doc, outcome: string, comment?: string | null): Promise<void> => {
  const text = comment?.trim().slice(0, MAX_STAGE_COMMENT)
  const { ts, n } = await sourceOf(payload, ticket)
  const def = stageDef(workflowFor(run.workspace), run.stage)
  if (text) await ts.comment(n, `${stageMarker(def?.jobs ? `${run.stage}/${run.job}` : run.stage)}\n${text}`)
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "outcome" = ${outcome}, "updated_at" = now() WHERE "id" = ${run.id}`)
  await record(payload, ticket.id, { run: run.id, outcome, cause: 'run:finished' })
  if (def?.jobs) return finishJob(payload, run, ticket, outcome, text || undefined)
  await advance(payload, ts, ticket, outcome, { by: 'factory', run, note: text || undefined })
}
