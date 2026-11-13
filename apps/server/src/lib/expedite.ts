import { live } from './workspace-delete'
import type { TicketSource } from '@bauherr/adapters'
import type { Payload, Where } from 'payload'
import { workflowFor } from './factory'
import { NEEDS_REFINEMENT } from './needs-you'
import { forgeOf, id } from './release'
import { inKindStage } from './stage-scope'
import { moveStage } from './stage-move'
import { inFlight as inFlightStages, nameOf } from './workflow'
import { enterStage } from './wip'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
/** Stages in which an expedite Ticket occupies the Workspace's one expedite slot, until it is done. */
const IGNORED = '<!-- bauherr:expedite-ignored -->'
const QUEUED = '<!-- bauherr:expedite-queued -->'
const HAS_PLAN = /^##\s+(Plan|Steps)\b/im

/** Settings > Factory > Workflow "Expedite lane" (default on). */
export const laneOn = async (payload: Payload, workspace: number | string): Promise<boolean> =>
  ((await payload.findByID({ collection: 'workspaces', id: workspace, select: { expediteLane: true }, ...o })) as Doc).expediteLane !== false

/** Who may put a Ticket on the fast lane at once (the Expedite action, an urgent request they file): an Admin; everyone else proposes it and an Admin decides. The one place that rule lives. */
export const canPutOnFastLane = (user: Doc | null | undefined): boolean => user?.role === 'admin'

/** The other expedite Tickets of `t`'s Workspace that hold a place: in flight and not yielded. */
const holding = (t: Doc, extra: Where): Where => ({ and: [{ workspace: { equals: id(t.workspace) } }, { expedite: { equals: true } }, { state: { equals: 'open' } }, { stage: { in: inFlightStages(workflowFor(t.workspace)) } }, { id: { not_equals: t.id } }, { expediteYieldedTo: { exists: false } }, extra] })
const inFlight = (payload: Payload, t: Doc, extra: Where) => payload.count({ collection: 'tickets', where: holding(t, extra), overrideAccess: true })

/** Parked: it waits for the owner (`needsYou`) and no Run of it is queued, awaiting a session or running. */
const parked = async (payload: Payload, t: Doc): Promise<boolean> =>
  !!t.needsYou && (await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { status: { in: ['queued', 'awaiting_session', 'running'] } }] }, overrideAccess: true })).totalDocs === 0

/** Whether another expedite Ticket of the Workspace is in flight. */
const slotTaken = async (payload: Payload, t: Doc): Promise<boolean> => (await inFlight(payload, t, {})).totalDocs > 0

/** The number of the Ticket holding the fast-lane slot that a queued expedite Ticket (not yet in flight) waits for; null otherwise. */
export const fastLaneHolder = async (payload: Payload, t: Doc): Promise<number | null> => {
  if (!t.expedite || t.expediteYieldedTo || t.state === 'closed' || inFlightStages(workflowFor(t.workspace)).includes(t.stage)) return null
  const [holder] = (await payload.find({ collection: 'tickets', where: holding(t, {}), sort: 'id', limit: 1, ...o })).docs as Doc[]
  return holder?.number ?? null
}

/**
 * Whether the lane serves `t` now: flagged, the lane on, and it holds the Workspace's one expedite slot. A Ticket already in flight holds it unless an older flagged Ticket (lower id) is in flight too,
 * so a second Ticket flagged while another is in flight gets no bypass; one outside the lane enters only when the slot is free. A Ticket that yielded its place (`expediteYieldedTo`) is outside the lane until it takes it back.
 */
export const isExpediting = async (payload: Payload, t: Doc): Promise<boolean> => {
  if (!t.expedite || t.expediteYieldedTo || t.state === 'closed' || !(await laneOn(payload, id(t.workspace)))) return false
  if (inFlightStages(workflowFor(t.workspace)).includes(t.stage)) return (await inFlight(payload, t, { id: { less_than: t.id } })).totalDocs === 0
  return !(await slotTaken(payload, t))
}

/** Posts `text` under `marker` once per Ticket; a forge error is logged and never stops the caller. */
export const commentOnce = async (payload: Payload, ts: TicketSource, number: number | string, marker: string, text: string): Promise<void> => {
  try {
    const n = String(number)
    if (!(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) await ts.comment(n, `${marker}\n${text}`)
  } catch (e) {
    payload.logger.warn({ err: e, ticket: number }, 'expedite comment failed')
  }
}

/** The Comment for a label the Workspace ignores. */
export const noteIgnored = (payload: Payload, ts: TicketSource, number: number | string) =>
  commentOnce(payload, ts, number, IGNORED, 'Bauherr: the Expedite lane is off in Settings > Factory > Workflow, so the `bauherr:expedite` label is ignored.')

/** Every Ticket that holds the slot is parked: each yields it to `t` (`expediteYieldedTo`) with one Comment; true when the slot is free after that. A running holder, or none parked, changes nothing. */
const yieldHolders = async (payload: Payload, t: Doc): Promise<boolean> => {
  const holders = (await payload.find({ collection: 'tickets', where: holding(t, {}), pagination: false, ...o })).docs as Doc[]
  for (const h of holders) if (!(await parked(payload, h))) return false
  for (const h of holders) {
    await payload.update({ collection: 'tickets', id: h.id, data: { expediteYieldedTo: t.id }, ...o })
    await commentOnce(payload, (await forgeOf(payload, id(h.product))).tickets, h.number, `<!-- bauherr:expedite-yielded #${t.number} -->`, `Bauherr: this Ticket waits for you, so it gave its fast-lane place to #${t.number}. It keeps the flag and gets the place back when it moves again and the place is free.`)
  }
  return true
}

/** A yielded Ticket that was closed or lost the flag drops the yield; one that is no longer parked takes the place back when no other Ticket holds it. */
const reenter = async (payload: Payload): Promise<void> => {
  const yielded = (await payload.find({ collection: 'tickets', where: { expediteYieldedTo: { exists: true } }, pagination: false, ...o })).docs as Doc[]
  for (const y of yielded) {
    try {
      if (y.state === 'closed' || !y.expedite || (!(await parked(payload, y)) && !(await slotTaken(payload, y)))) await payload.update({ collection: 'tickets', id: y.id, data: { expediteYieldedTo: null }, ...o })
    } catch (e) {
      payload.logger.error({ err: e, ticket: y.id }, 'expedite re-entry failed')
    }
  }
}

/**
 * Sends each waiting expedite Ticket without a stage straight past Triage: to `plan`, or to `build` when its body has a `## Plan` or `## Steps` section.
 * One per Workspace is in flight; the others wait, oldest first, with a Comment, unless every holder is parked (waits for the owner, no active Run): then it yields its place to the waiting one. A flagged Ticket of a Workspace that turned the lane off loses the flag.
 * The Run itself starts in the same poll (`startMissingRuns`).
 */
export const startExpedites = async (payload: Payload): Promise<number> => {
  // A Workspace that turned the lane off drops the flag of every open Ticket (not only the waiting ones): the flag must never outlive the setting.
  const off = (await payload.find({ collection: 'workspaces', where: { and: [{ expediteLane: { equals: false } }, live] }, select: {}, pagination: false, ...o })).docs.map((w) => w.id)
  if (off.length) {
    const flagged = await payload.find({ collection: 'tickets', where: { and: [{ workspace: { in: off } }, { expedite: { equals: true } }] }, select: {}, pagination: false, ...o })
    for (const t of flagged.docs) await payload.update({ collection: 'tickets', id: t.id, data: { expedite: false }, ...o })
  }
  await reenter(payload)
  const waiting = (await payload.find({ collection: 'tickets', where: { and: [{ expedite: { equals: true } }, { state: { equals: 'open' } }, { or: [{ stage: { exists: false } }, await inKindStage(payload, 'triage')] }] }, sort: 'createdAt', pagination: false, ...o })).docs as Doc[]
  let started = 0
  for (const t of waiting) {
    try {
      const wf = workflowFor(t.workspace)
      if (t.mergeSha || t.waitingFor || (t.labels as string[] | undefined)?.includes(NEEDS_REFINEMENT)) continue
      // A Triage Run being worked on finishes first (its outcome then meets the flag). An unclaimed one is cancelled only when the Ticket enters the lane: a queued Ticket keeps it.
      const triage = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'triage' } }, { status: { in: ['queued', 'awaiting_session', 'running'] } }] }, pagination: false, ...o })).docs as Doc[]
      if (triage.some((r) => r.status === 'running')) continue
      const { tickets: ts } = await forgeOf(payload, id(t.product))
      if (!(await laneOn(payload, id(t.workspace)))) {
        await payload.update({ collection: 'tickets', id: t.id, data: { expedite: false }, ...o })
        await noteIgnored(payload, ts, t.number)
        continue
      }
      if ((await slotTaken(payload, t)) && !(await yieldHolders(payload, t))) {
        await commentOnce(payload, ts, t.number, QUEUED, 'Bauherr: another expedite Ticket is in flight. This one is next and enters the lane when it is released.')
        continue
      }
      for (const r of triage) await payload.update({ collection: 'runs', id: r.id, data: { status: 'cancelled', error: 'expedite: the lane skips Triage', finishedAt: new Date().toISOString() }, ...o })
      const stage = HAS_PLAN.test((await ts.get(String(t.number))).body ?? '') ? nameOf(wf, 'build') : nameOf(wf, 'plan')
      const entered = await enterStage(payload, t, stage, async () => {
        await moveStage(payload, ts, t, stage, 'expedite')
        await payload.update({ collection: 'tickets', id: t.id, data: { stage }, ...o })
      })
      if (entered !== 'moved') continue
      await ts.comment(String(t.number), `Bauherr: expedite. Triage skipped, straight to \`${stage}\`.`)
      started++
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'startExpedites failed')
    }
  }
  return started
}

