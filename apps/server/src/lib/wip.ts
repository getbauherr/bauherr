import { sql } from '@payloadcms/db-postgres'
import type { Payload, Where } from 'payload'
import { startReviewIfReady, startRunIfNeeded } from '../jobs'
import { workflowFor } from './factory'
import { executionOrder } from './frontier'
import { logins } from './forge-channel'
import { NEEDS_REFINEMENT } from './needs-you'
import { isExpediting } from './expedite'
import { holdOverlap } from './overlap'
import { forgeOf, id } from './release'
import { moveStage } from './stage-move'
import { waitingText, wipLimit } from './wip-limits'
import { heldStages, is, wipStages } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** The query behind the count of `stage`: open Tickets in it, all but those still waiting to enter it (one finished here and waiting for the next column still occupies this one), and never parents (their stage is `parent`). Release is never waited for (`waitingFor` cannot hold it). */
export const wipWhere = (workspace: number | string, stage: string): Where => ({ and: [{ workspace: { equals: workspace } }, { stage: { equals: stage } }, { state: { equals: 'open' } }, { expedite: { not_equals: true } }, ...(is(workflowFor(workspace), stage, 'release') ? [] : [{ waitingFor: { not_equals: stage } }])] })

/** The number of Tickets taking a slot in `stage`. This is the only definition of the count; the Board header uses `wipCounts`. */
export const wipCount = async (payload: Payload, workspace: number | string, stage: string): Promise<number> =>
  (await payload.count({ collection: 'tickets', where: wipWhere(workspace, stage), overrideAccess: true })).totalDocs

/** `wipCount` of every limited column. */
export const wipCounts = async (payload: Payload, workspace: number | string): Promise<Record<string, number>> =>
  Object.fromEntries(await Promise.all(wipStages(workflowFor(workspace)).map(async (s) => [s, await wipCount(payload, workspace, s)])))

/**
 * The pull rule: a Ticket may enter `stage` only while it has room. `move` does the whole move (label and `stage` row) and runs under a per-(Workspace, stage) advisory lock,
 * so two entries into one free slot cannot both win. A full column leaves the Ticket where it is, marked `waitingFor`, with no Run. Release is never gated, nor are returns to an earlier stage, nor is an expedite Ticket (it takes an extra slot and is not counted). A Build entry is also held (`'held'`, waiting with a reason, no limit involved) while an earlier Ticket overlaps its paths.
 */
export const enterStage = async (payload: Payload, t: Doc, stage: string, move: () => Promise<void>): Promise<'moved' | 'waiting' | 'held'> => {
  const wf = workflowFor(t.workspace)
  if (is(wf, stage, 'build') && (await holdOverlap(payload, t))) return 'held'
  const ws = Number(id(t.workspace))
  const limit = wipLimit(await payload.findByID({ collection: 'workspaces', id: ws, select: { wipLimits: true }, ...o }), stage, wf)
  const enter = async () => {
    await move()
    if (t.waitingFor) await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: null, waitingReason: null }, ...o })
    return 'moved' as const
  }
  if (limit == null || (await isExpediting(payload, t))) return enter()
  return payload.db.drizzle.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ws}::int, hashtext(${'wip:' + stage}))`)
    if ((await wipCount(payload, ws, stage)) < limit) return enter()
    if (t.waitingFor !== stage || t.waitingReason) await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: stage, waitingReason: null }, ...o })
    return 'waiting' as const
  })
}

/** The move of a waiting Ticket into `stage`: forge label (dropping the Triage hold when it leaves it) and `stage` row; a Ticket already labelled `stage` (a spawned child) only loses its hold. */
const completeMove = async (payload: Payload, t: Doc, stage: string): Promise<void> => {
  if (t.stage !== stage) {
    const { tickets: ts } = await forgeOf(payload, id(t.product))
    if (is(workflowFor(t.workspace), stage, 'plan') && (t.labels as string[] | undefined)?.includes(NEEDS_REFINEMENT)) await ts.removeLabels(String(t.number), [NEEDS_REFINEMENT])
    await moveStage(payload, ts, t, stage, 'pulled')
    await payload.update({ collection: 'tickets', id: t.id, data: { stage }, ...o })
  }
}

/** Starts the Run the pulled Ticket's new column calls for (a Ticket with an unreviewed assignee waits for its gate). */
export const startAfterPull = async (payload: Payload, t: Doc, stage: string): Promise<void> => {
  const fresh = (await payload.findByID({ collection: 'tickets', id: t.id, ...o })) as Doc
  if (is(workflowFor(t.workspace), stage, 'human')) return
  if (is(workflowFor(t.workspace), stage, 'review')) await startReviewIfReady(payload, fresh)
  else if (logins(fresh.assignees).every((a) => logins(fresh.gateAssignees).includes(a))) await startRunIfNeeded(payload, fresh as { id: number; workspace?: unknown }, stage)
}

/**
 * Per Workspace, columns right to left: while a column has room, the best-ranked Ticket waiting for it enters and starts its Run.
 * Runs on every poll, so a raised limit or a Ticket that left a column takes effect on the next one. Blocked Tickets wait without taking a slot.
 */
export const pullWaiting = async (payload: Payload): Promise<number> => {
  const waiting = (await payload.find({ collection: 'tickets', where: { and: [{ waitingFor: { exists: true } }, { state: { equals: 'open' } }] }, pagination: false, depth: 1, overrideAccess: true })).docs as Doc[]
  let pulled = 0
  for (const ws of new Set(waiting.map((t) => id(t.workspace)))) {
    const wf = workflowFor(ws)
    for (const stage of heldStages(wf)) {
      const queue = waiting
        .filter((t) => id(t.workspace) === ws && t.waitingFor === stage && !((t.blockedBy as Doc[]) ?? []).some((b) => b.state !== 'closed'))
        .sort((a, b) => executionOrder({ id: a.id, number: a.number, rank: a.rank, stage }, { id: b.id, number: b.number, rank: b.rank, stage }, wf))
      for (const t of queue) {
        try {
          const entered = await enterStage(payload, t, stage, () => completeMove(payload, t, stage))
          if (entered === 'waiting') break
          if (entered === 'held') continue
          await startAfterPull(payload, t, stage)
          pulled++
        } catch (e) {
          payload.logger.error({ err: e, ticket: t.id }, 'pullWaiting failed')
        }
      }
    }
  }
  return pulled
}

/** Text of a waiting Ticket's chip and notice, e.g. "Waiting: Build is full (2/2)"; null when it is not waiting. */
export const waitingLabel = async (payload: Payload, t: Doc): Promise<string | null> => {
  if (!t.waitingFor) return null
  const wf = workflowFor(t.workspace)
  const ws = await payload.findByID({ collection: 'workspaces', id: id(t.workspace), select: { wipLimits: true }, ...o })
  return waitingText(wf, t.waitingFor, await wipCount(payload, id(t.workspace), t.waitingFor), wipLimit(ws, t.waitingFor, wf), t.waitingReason)
}
