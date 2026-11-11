import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { advance } from './advance'
import { sourceOf } from './actions'
import { workflowFor } from './factory'
import { record } from './history'
import { stage as stageDef } from './workflow'

type Doc = Record<string, any>

export const MAX_STAGE_COMMENT = 60_000
export const stageMarker = (name: string) => `<!-- bauherr:stage:${name} -->`

/** The outcome keys an `agent` stage accepts. */
export const outcomesOf = (run: Doc): string[] => Object.keys(stageDef(workflowFor(run.workspace), run.stage)?.outcomes ?? {})

/** Throws unless `outcome` is one of the stage's outcome keys. */
export const assertOutcome = (run: Doc, outcome: unknown): string => {
  const keys = outcomesOf(run)
  if (typeof outcome !== 'string' || !keys.includes(outcome)) throw new Error(`outcome must be one of ${keys.join(', ')}`)
  return outcome
}

/**
 * The end of an `agent` Run that reported `outcome` (already validated; the Run row is already `succeeded`): posts the one stage comment (marked `<!-- bauherr:stage:<name> -->`),
 * records `runs.outcome` and takes the Ticket along the stage's outcome with `advance`; the comment is the hand-back instruction when the outcome leads back to Build.
 */
export const finishAgentRun = async (payload: Payload, run: Doc, ticket: Doc, outcome: string, comment?: string | null): Promise<void> => {
  const text = comment?.trim().slice(0, MAX_STAGE_COMMENT)
  const { ts, n } = await sourceOf(payload, ticket)
  if (text) await ts.comment(n, `${stageMarker(run.stage)}\n${text}`)
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "outcome" = ${outcome}, "updated_at" = now() WHERE "id" = ${run.id}`)
  await record(payload, ticket.id, { run: run.id, outcome, cause: 'run:finished' })
  await advance(payload, ts, ticket, outcome, { by: 'factory', run, note: text || undefined })
}
