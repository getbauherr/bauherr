import { sql } from '@payloadcms/db-postgres'
import type { Payload, Where } from 'payload'
import { startReviewIfReady, startRunIfNeeded } from '../jobs'
import { queueEpicMergeMain } from './actions'
import { NOT_PARKED } from './epic'
import { workflowFor } from './factory'
import { executionOrder } from './frontier'
import { logins } from './forge-channel'
import { NEEDS_REFINEMENT } from './needs-you'
import { commentOnce, isExpediting } from './expedite'
import { holdOverlap } from './overlap'
import { forgeOf, id } from './release'
import { startReadyJobs } from './stage-jobs'
import { moveStage } from './stage-move'
import { waitingText, wipLimit } from './wip-limits'
import { heldStages, is, stage as stageDef, title, wipStages } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/**
 * The query behind the count of `stage`: open Tickets in it that take a slot. Not counted: parents (their stage is `parent`), epic-parked Tickets, Tickets parked on a need outside an approval (`parkedNeed`),
 * and Tickets waiting to enter the column. A Plan Ticket waiting for any column (an approved plan waiting for Build) does not count either; in the other columns a finished Ticket waiting for the next one
 * still occupies this one. Release is never waited for (`waitingFor` cannot hold it).
 */
export const wipWhere = (workspace: number | string, stage: string): Where => {
  const wf = workflowFor(workspace)
  const waiting: Where[] = is(wf, stage, 'release') ? [] : [is(wf, stage, 'plan') ? { waitingFor: { exists: false } } : { waitingFor: { not_equals: stage } }]
  return { and: [{ workspace: { equals: workspace } }, { stage: { equals: stage } }, { state: { equals: 'open' } }, { expedite: { not_equals: true } }, NOT_PARKED, { parkedNeed: { exists: false } }, ...waiting] }
}

/** The number of Tickets taking a slot in `stage`. This is the only definition of the count; the Board header uses `wipCounts`. */
export const wipCount = async (payload: Payload, workspace: number | string, stage: string): Promise<number> =>
  (await payload.count({ collection: 'tickets', where: wipWhere(workspace, stage), overrideAccess: true })).totalDocs

/** `wipCount` of every limited column, with the open Tickets there that are parked (on a need or as an epic) and take no slot. */
export const wipCounts = async (payload: Payload, workspace: number | string): Promise<Record<string, { count: number; parked: number }>> =>
  Object.fromEntries(
    await Promise.all(
      wipStages(workflowFor(workspace)).map(async (s) => [
        s,
        { count: await wipCount(payload, workspace, s), parked: (await payload.count({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { stage: { equals: s } }, { state: { equals: 'open' } }, { or: [{ parkedNeed: { exists: true } }, { parked: { equals: true } }] }] }, overrideAccess: true })).totalDocs },
      ]),
    ),
  )

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
    // A Ticket waiting in its own column (`rejoin`) keeps its reason: without one the Ticket guard drops `waitingFor`.
    const own = t.stage === stage
    if (t.waitingFor !== stage || (t.waitingReason && !own)) await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: stage, waitingReason: null }, ...o })
    return 'waiting' as const
  })
}

/**
 * A parked Ticket whose need cleared takes its slot back without displacing anyone. With room (or no limit, Release, a fast-lane Ticket) it only loses `parkedNeed`; with the column full it waits for its own
 * column (`waitingFor` with the reason the Ticket guard requires for a Ticket that waits in its own column, no Run) and `pullWaiting` starts it when a slot frees. One Comment per parking says so.
 */
export const rejoin = async (payload: Payload, t: Doc): Promise<'moved' | 'waiting'> => {
  const wf = workflowFor(t.workspace)
  const ws = Number(id(t.workspace))
  const stage = String(t.stage)
  const limit = wipLimit(await payload.findByID({ collection: 'workspaces', id: ws, select: { wipLimits: true }, ...o }), stage, wf)
  const clear = () => payload.update({ collection: 'tickets', id: t.id, data: { parkedNeed: null }, ...o })
  if (limit == null || is(wf, stage, 'release') || (await isExpediting(payload, t))) return clear().then(() => 'moved' as const)
  const count = await payload.db.drizzle.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ws}::int, hashtext(${'wip:' + stage}))`)
    const n = await wipCount(payload, ws, stage)
    if (n < limit) await clear()
    else await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: stage, waitingReason: `${title(wf, stage)} is full (${n}/${limit})`, parkedNeed: null }, ...o })
    return n
  })
  if (count < limit) return 'moved'
  const latest = (await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, sort: '-createdAt', limit: 1, select: {}, ...o })).docs[0]
  await commentOnce(payload, (await forgeOf(payload, id(t.product))).tickets, t.number, `<!-- bauherr:unparked:${t.parkedNeed}:${latest?.id ?? ''} -->`, `Bauherr: the need is cleared, but ${title(wf, stage)} is full (${count}/${limit}). This Ticket starts as soon as a slot frees.`)
  return 'waiting'
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
  if (fresh.parked || is(workflowFor(t.workspace), stage, 'human')) return
  if (is(workflowFor(t.workspace), stage, 'review')) await startReviewIfReady(payload, fresh)
  else if (logins(fresh.assignees).every((a) => logins(fresh.gateAssignees).includes(a))) {
    if (!is(workflowFor(t.workspace), stage, 'plan') && stageDef(workflowFor(t.workspace), stage)?.jobs) await startReadyJobs(payload, fresh)
    else await startRunIfNeeded(payload, fresh as { id: number; workspace?: unknown }, stage)
  }
}

/**
 * Per Workspace, columns right to left: while a column has room, the best-ranked Ticket waiting for it enters and starts its Run.
 * Runs on every poll, so a raised limit or a Ticket that left a column takes effect on the next one. Blocked Tickets wait without taking a slot.
 */
export const pullWaiting = async (payload: Payload): Promise<number> => {
  const waiting = (await payload.find({ collection: 'tickets', where: { and: [{ waitingFor: { exists: true } }, { state: { equals: 'open' } }, NOT_PARKED] }, pagination: false, depth: 1, overrideAccess: true })).docs as Doc[]
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
          if (t.epic && is(wf, stage, 'review')) await queueEpicMergeMain(payload, t)
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
