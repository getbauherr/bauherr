import { sql } from '@payloadcms/db-postgres'
import type { TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { escalate as escalateRun } from './escalation'
import { workflowFor } from './factory'
import { moveStage } from './stage-move'
import { enterStage, startAfterPull } from './wip'
import { APPROVED_PLAN } from './needs-you'
import { handBackToBuild, sendToBacklog, sourceOf, startReviewNow } from './actions'
import { is, isForward, nameOf, stage as stageDef, target } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

export type Advanced = { stage: string | null; entered: 'moved' | 'waiting' | 'held' | 'backlog' | 'escalated' | 'unrouted' }
export type AdvanceOpts = { by: string; run?: Doc; why?: string; note?: string }

/**
 * Takes a Ticket out of its stage along `outcome`: enters the target the workflow names for it, by the TARGET's kind.
 * `escalate` is the escalation ladder of the finished `run`, `backlog` is the untriaged state. plan and build (from upstream) only move; their Runs start with the poller or the caller.
 * A plan target reached from a later stage (a replan) loses its approval label and gets a new plan Run. A build target reached from a later stage is a hand-back (same MR, `note` into the worklog, no review round); review enters through the WIP rule; an `agent` stage also gets its Run, a `human` stage needs the owner.
 * An outcome the stage does not map ends the `run` as `needs_human` (decision) and leaves the Ticket where it is.
 */
export const advance = async (payload: Payload, ts: TicketSource | null, ticket: Doc, outcome: string, opts: AdvanceOpts): Promise<Advanced> => {
  const wf = workflowFor(ticket.workspace)
  const from = ticket.stage ?? nameOf(wf, 'triage')
  const to = target(wf, from, outcome)
  if (!to) {
    const reason = `outcome "${outcome}" is not mapped by stage "${from}"`
    if (!opts.run) throw new Error(reason)
    await payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'needs_human', "reason_kind" = 'decision', "error" = ${reason}, "finished_at" = coalesce("finished_at", now()), "updated_at" = now() WHERE "id" = ${opts.run.id}`)
    const { ts: src, n } = await sourceOf(payload, ticket)
    await src.comment(n, `Bauherr needs a human: ${reason}.`)
    return { stage: null, entered: 'unrouted' }
  }
  if (to === 'escalate') {
    if (!opts.run) throw new Error(`"${from}" escalates on "${outcome}" and needs the Run`)
    await escalateRun(payload, ticket, opts.run, opts.note ?? `${from}: ${outcome}`)
    return { stage: from, entered: 'escalated' }
  }
  if (to === 'backlog') {
    await sendToBacklog(payload, ticket, { executor: opts.by === 'factory' ? 'factory' : 'human', actor: opts.by, note: opts.note })
    return { stage: null, entered: 'backlog' }
  }
  const def = stageDef(wf, to)!
  const source = ts ?? (await sourceOf(payload, ticket)).ts
  const why = opts.why ?? `outcome:${outcome}`
  if (def.kind === 'release' || def.kind === 'done' || def.kind === 'container') throw new Error(`stage "${to}" (${def.kind}) is entered by its own logic, not by outcome "${outcome}" of "${from}"`)
  if (def.kind === 'build' && isForward(wf, to, from)) {
    await handBackToBuild(payload, ticket, { ts: source, n: String(ticket.number) }, opts.note ?? `Back to ${to} from ${from} (${outcome}).`)
    return { stage: to, entered: 'moved' }
  }
  const replan = def.kind === 'plan' && isForward(wf, to, from)
  const entered = await enterStage(payload, ticket, to, async () => {
    await moveStage(payload, source, ticket, to, why)
    await payload.update({ collection: 'tickets', id: ticket.id, data: { stage: to, ...(def.kind === 'review' && { reviewWaitingSince: null }) }, overrideAccess: true })
  })
  if (entered === 'moved' && def.kind === 'review') await startReviewNow(payload, ticket.id)
  if (entered === 'moved' && replan) {
    // A return to the plan stage plans again and needs a new approval: drop the old one, then start the Run `startMissingRuns` would skip (the stage already had one).
    await source.removeLabels(String(ticket.number), [APPROVED_PLAN])
    const labels = ((await payload.findByID({ collection: 'tickets', id: ticket.id, select: { labels: true }, ...o })) as Doc).labels as string[] | undefined
    await payload.update({ collection: 'tickets', id: ticket.id, data: { labels: (labels ?? []).filter((l) => l !== APPROVED_PLAN) }, ...o })
  }
  if (entered === 'moved' && (def.kind === 'agent' || replan)) await startAfterPull(payload, ticket, to)
  return { stage: to, entered }
}
