import { live } from './workspace-delete'
import type { TicketSource } from '@bauherr/adapters'
import type { Payload, Where } from 'payload'
import { workflowFor } from './factory'
import { EXPEDITE_LABEL, NEEDS_REFINEMENT } from './needs-you'
import { forgeOf, id } from './release'
import { inKindStage } from './stage-scope'
import { moveStage } from './stage-move'
import { inFlight as inFlightStages, nameOf } from './workflow'
import { enterStage } from './wip'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
const IGNORED = '<!-- bauherr:expedite-ignored -->'
const QUEUED = '<!-- bauherr:expedite-queued -->'
const HAS_PLAN = /^##\s+(Plan|Steps)\b/im

export const laneOn = async (payload: Payload, workspace: number | string): Promise<boolean> =>
  ((await payload.findByID({ collection: 'workspaces', id: workspace, select: { expediteLane: true }, ...o })) as Doc).expediteLane !== false

export const canPutOnFastLane = (user: Doc | null | undefined): boolean => user?.role === 'admin'

const holding = (t: Doc, extra: Where): Where => ({ and: [{ workspace: { equals: id(t.workspace) } }, { expedite: { equals: true } }, { state: { equals: 'open' } }, { stage: { in: inFlightStages(workflowFor(t.workspace)) } }, { id: { not_equals: t.id } }, { expediteYieldedTo: { exists: false } }, extra] })
const inFlight = (payload: Payload, t: Doc, extra: Where) => payload.count({ collection: 'tickets', where: holding(t, extra), overrideAccess: true })

const parked = async (payload: Payload, t: Doc): Promise<boolean> =>
  !!t.needsYou && (await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { status: { in: ['queued', 'awaiting_session', 'running'] } }] }, overrideAccess: true })).totalDocs === 0

export const laneWaiter = async (payload: Payload, t: Doc): Promise<boolean> =>
  !!t.expedite && !t.expediteYieldedTo && (await payload.count({ collection: 'tickets', where: { and: [{ workspace: { equals: id(t.workspace) } }, { expedite: { equals: true } }, { state: { equals: 'open' } }, { id: { not_equals: t.id } }, { expediteYieldedTo: { exists: false } }, { or: [{ stage: { exists: false } }, { stage: { not_in: inFlightStages(workflowFor(t.workspace)) } }] }] }, overrideAccess: true })).totalDocs > 0

export const releaseFastLane = async (payload: Payload, t: Doc): Promise<'released'> => {
  const { tickets: ts } = await forgeOf(payload, id(t.product))
  await ts.removeLabels(String(t.number), [EXPEDITE_LABEL])
  await payload.update({ collection: 'tickets', id: t.id, data: { expedite: false }, ...o })
  await ts.comment(String(t.number), 'Bauherr: this Ticket waits for a person while another expedite Ticket waits for the fast lane, so it gave up its place and lost the `bauherr:expedite` label. Add the label again to put it back on the lane.')
  return 'released'
}

const slotTaken = async (payload: Payload, t: Doc): Promise<boolean> => (await inFlight(payload, t, {})).totalDocs > 0

export const fastLaneHolderDoc = async (payload: Payload, t: Doc): Promise<Doc | null> => {
  if (!t.expedite || t.expediteYieldedTo || t.state === 'closed' || inFlightStages(workflowFor(t.workspace)).includes(t.stage)) return null
  return ((await payload.find({ collection: 'tickets', where: holding(t, {}), sort: 'id', limit: 1, ...o })).docs[0] as Doc | undefined) ?? null
}

export const fastLaneHolder = async (payload: Payload, t: Doc): Promise<number | null> => (await fastLaneHolderDoc(payload, t))?.number ?? null

export const isExpediting = async (payload: Payload, t: Doc): Promise<boolean> => {
  if (!t.expedite || t.expediteYieldedTo || t.state === 'closed' || !(await laneOn(payload, id(t.workspace)))) return false
  if (inFlightStages(workflowFor(t.workspace)).includes(t.stage)) return (await inFlight(payload, t, { id: { less_than: t.id } })).totalDocs === 0
  return !(await slotTaken(payload, t))
}

export const commentOnce = async (payload: Payload, ts: TicketSource, number: number | string, marker: string, text: string): Promise<void> => {
  try {
    const n = String(number)
    if (!(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) await ts.comment(n, `${marker}\n${text}`)
  } catch (e) {
    payload.logger.warn({ err: e, ticket: number }, 'expedite comment failed')
  }
}

export const noteIgnored = (payload: Payload, ts: TicketSource, number: number | string) =>
  commentOnce(payload, ts, number, IGNORED, 'Bauherr: the Expedite lane is off in Settings > Factory > Workflow, so the `bauherr:expedite` label is ignored.')

const yieldHolders = async (payload: Payload, t: Doc): Promise<boolean> => {
  const holders = (await payload.find({ collection: 'tickets', where: holding(t, {}), pagination: false, ...o })).docs as Doc[]
  for (const h of holders) if (!(await parked(payload, h))) return false
  for (const h of holders) {
    await payload.update({ collection: 'tickets', id: h.id, data: { expediteYieldedTo: t.id }, ...o })
    await commentOnce(payload, (await forgeOf(payload, id(h.product))).tickets, h.number, `<!-- bauherr:expedite-yielded #${t.number} -->`, `Bauherr: this Ticket waits for you, so it gave its fast-lane place to #${t.number}. It keeps the flag and gets the place back when it moves again and the place is free.`)
  }
  return true
}

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

export const startExpedites = async (payload: Payload): Promise<number> => {
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

