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

export const wipWhere = (workspace: number | string, stage: string): Where => {
  const wf = workflowFor(workspace)
  const waiting: Where[] = is(wf, stage, 'release') ? [] : [is(wf, stage, 'plan') ? { waitingFor: { exists: false } } : { waitingFor: { not_equals: stage } }]
  return { and: [{ workspace: { equals: workspace } }, { stage: { equals: stage } }, { state: { equals: 'open' } }, { expedite: { not_equals: true } }, NOT_PARKED, { parkedNeed: { exists: false } }, ...waiting] }
}

export const wipCount = async (payload: Payload, workspace: number | string, stage: string): Promise<number> =>
  (await payload.count({ collection: 'tickets', where: wipWhere(workspace, stage), overrideAccess: true })).totalDocs

export const wipCounts = async (payload: Payload, workspace: number | string): Promise<Record<string, { count: number; parked: number }>> =>
  Object.fromEntries(
    await Promise.all(
      wipStages(workflowFor(workspace)).map(async (s) => [
        s,
        { count: await wipCount(payload, workspace, s), parked: (await payload.count({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { stage: { equals: s } }, { state: { equals: 'open' } }, { or: [{ parkedNeed: { exists: true } }, { parked: { equals: true } }] }] }, overrideAccess: true })).totalDocs },
      ]),
    ),
  )

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
    const own = t.stage === stage
    if (t.waitingFor !== stage || (t.waitingReason && !own)) await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: stage, waitingReason: null }, ...o })
    return 'waiting' as const
  })
}

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

const completeMove = async (payload: Payload, t: Doc, stage: string): Promise<void> => {
  if (t.stage !== stage) {
    const { tickets: ts } = await forgeOf(payload, id(t.product))
    if (is(workflowFor(t.workspace), stage, 'plan') && (t.labels as string[] | undefined)?.includes(NEEDS_REFINEMENT)) await ts.removeLabels(String(t.number), [NEEDS_REFINEMENT])
    await moveStage(payload, ts, t, stage, 'pulled')
    await payload.update({ collection: 'tickets', id: t.id, data: { stage }, ...o })
  }
}

export const startAfterPull = async (payload: Payload, t: Doc, stage: string): Promise<void> => {
  const fresh = (await payload.findByID({ collection: 'tickets', id: t.id, ...o })) as Doc
  if (fresh.parked || is(workflowFor(t.workspace), stage, 'human')) return
  if (is(workflowFor(t.workspace), stage, 'review')) await startReviewIfReady(payload, fresh)
  else if (logins(fresh.assignees).every((a) => logins(fresh.gateAssignees).includes(a))) {
    if (!is(workflowFor(t.workspace), stage, 'plan') && stageDef(workflowFor(t.workspace), stage)?.jobs) await startReadyJobs(payload, fresh)
    else await startRunIfNeeded(payload, fresh as { id: number; workspace?: unknown }, stage)
  }
}

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

export const waitingLabel = async (payload: Payload, t: Doc): Promise<string | null> => {
  if (!t.waitingFor) return null
  const wf = workflowFor(t.workspace)
  const ws = await payload.findByID({ collection: 'workspaces', id: id(t.workspace), select: { wipLimits: true }, ...o })
  return waitingText(wf, t.waitingFor, await wipCount(payload, id(t.workspace), t.waitingFor), wipLimit(ws, t.waitingFor, wf), t.waitingReason)
}
