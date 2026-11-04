import type { TicketSource } from '@bauherr/adapters'
import type { Payload, Where } from 'payload'
import { NEEDS_REFINEMENT } from './needs-you'
import { forgeOf, id } from './release'
import { moveStage } from './stage-move'
import { enterStage } from './wip'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
/** Stages in which an expedite Ticket occupies the Workspace's one expedite slot, until it is done. */
const IN_FLIGHT = ['plan', 'build', 'review', 'release']
const IGNORED = '<!-- bauherr:expedite-ignored -->'
const QUEUED = '<!-- bauherr:expedite-queued -->'
const HAS_PLAN = /^##\s+(Plan|Steps)\b/im

/** Settings > Workflow "Expedite lane" (default on). */
export const laneOn = async (payload: Payload, workspace: number | string): Promise<boolean> =>
  ((await payload.findByID({ collection: 'workspaces', id: workspace, select: { expediteLane: true }, ...o })) as Doc).expediteLane !== false

const inFlight = (payload: Payload, t: Doc, extra: Where) =>
  payload.count({ collection: 'tickets', where: { and: [{ workspace: { equals: id(t.workspace) } }, { expedite: { equals: true } }, { state: { equals: 'open' } }, { stage: { in: IN_FLIGHT } }, { id: { not_equals: t.id } }, extra] }, overrideAccess: true })

/** Whether another expedite Ticket of the Workspace is in flight. */
const slotTaken = async (payload: Payload, t: Doc): Promise<boolean> => (await inFlight(payload, t, {})).totalDocs > 0

/**
 * Whether the lane serves `t` now: flagged, the lane on, and it holds the Workspace's one expedite slot. A Ticket already in flight holds it unless an older flagged Ticket (lower id) is in flight too,
 * so a second Ticket flagged while another is in flight gets no bypass; one outside the lane enters only when the slot is free.
 */
export const isExpediting = async (payload: Payload, t: Doc): Promise<boolean> => {
  if (!t.expedite || t.state === 'closed' || !(await laneOn(payload, id(t.workspace)))) return false
  if (IN_FLIGHT.includes(t.stage)) return (await inFlight(payload, t, { id: { less_than: t.id } })).totalDocs === 0
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
  commentOnce(payload, ts, number, IGNORED, 'Bauherr: the Expedite lane is off in Settings > Workflow, so the `bauherr:expedite` label is ignored.')

/**
 * Sends each waiting expedite Ticket without a stage straight past Triage: to `plan`, or to `build` when its body has a `## Plan` or `## Steps` section.
 * One per Workspace is in flight; the others wait, oldest first, with a Comment. A flagged Ticket of a Workspace that turned the lane off loses the flag.
 * The Run itself starts in the same poll (`startMissingRuns`).
 */
export const startExpedites = async (payload: Payload): Promise<number> => {
  // A Workspace that turned the lane off drops the flag of every open Ticket (not only the waiting ones): the flag must never outlive the setting.
  const off = (await payload.find({ collection: 'workspaces', where: { expediteLane: { equals: false } }, select: {}, pagination: false, ...o })).docs.map((w) => w.id)
  if (off.length) {
    const flagged = await payload.find({ collection: 'tickets', where: { and: [{ workspace: { in: off } }, { expedite: { equals: true } }] }, select: {}, pagination: false, ...o })
    for (const t of flagged.docs) await payload.update({ collection: 'tickets', id: t.id, data: { expedite: false }, ...o })
  }
  const waiting = (await payload.find({ collection: 'tickets', where: { and: [{ expedite: { equals: true } }, { state: { equals: 'open' } }, { or: [{ stage: { exists: false } }, { stage: { equals: 'triage' } }] }] }, sort: 'createdAt', pagination: false, ...o })).docs as Doc[]
  let started = 0
  for (const t of waiting) {
    try {
      if (t.mergeSha || t.waitingFor || (t.labels as string[] | undefined)?.includes(NEEDS_REFINEMENT)) continue
      const { tickets: ts } = await forgeOf(payload, id(t.product))
      if (!(await laneOn(payload, id(t.workspace)))) {
        await payload.update({ collection: 'tickets', id: t.id, data: { expedite: false }, ...o })
        await noteIgnored(payload, ts, t.number)
        continue
      }
      if (await slotTaken(payload, t)) {
        await commentOnce(payload, ts, t.number, QUEUED, 'Bauherr: another expedite Ticket is in flight. This one is next and enters the lane when it is released.')
        continue
      }
      const stage = HAS_PLAN.test((await ts.get(String(t.number))).body ?? '') ? 'build' : 'plan'
      const entered = await enterStage(payload, t, stage, async () => {
        await moveStage(payload, ts, t, stage)
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

