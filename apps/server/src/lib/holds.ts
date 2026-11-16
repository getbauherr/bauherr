import type { Payload, Where } from 'payload'
import { workflowFor } from './factory'
import { fastLaneHolderDoc, laneOn } from './expedite'
import { fastLaneText, overlapText } from './hold-text'
import { connectedOfRole } from './presence'
import { id } from './release'
import { wipCount } from './wip'
import { wipLimit } from './wip-limits'
import { byKind, heldStages, title } from './workflow'

type Doc = Record<string, any>
const o = { depth: 1, overrideAccess: true, pagination: false } as const

/** A Ticket as a hold names it: where it is, and the link to it. */
export type HoldTicket = { id: number; number: number; href: string }
/** A shared hold of a Workspace: what is held, who or what holds it, who waits, and a link to the cause. `href` is the Ticket, the Board filtered to the stage, or the Agent team page with the role preselected. */
export type Hold = { text: string; waiting: HoldTicket[]; href: string } & (
  | { kind: 'fast-lane'; holder: HoldTicket }
  | { kind: 'wip'; stage: string; count: number; limit: number }
  | { kind: 'overlap'; holder: HoldTicket; stage: string }
  | { kind: 'no-agent'; role: string }
)

const ref = (t: Doc): HoldTicket => ({ id: t.id, number: t.number, href: `/tickets/${t.id}` })
const OVERLAP = /^overlaps #(\d+)$/

/**
 * The shared holds that stop work in `workspace`, derived from current state (nothing is stored): the fast lane held by an expedite Ticket, a full WIP column,
 * a Build held for shared paths, and a role with Runs waiting and no connected agent. A hold with nobody waiting for it is not listed.
 */
export const holdsOf = async (payload: Payload, workspace: number | string): Promise<Hold[]> => {
  const wf = workflowFor(workspace)
  const holds: Hold[] = []
  const open: Where[] = [{ workspace: { equals: workspace } }, { state: { equals: 'open' } }]

  if (await laneOn(payload, workspace)) {
    const flagged = (await payload.find({ collection: 'tickets', where: { and: [...open, { expedite: { equals: true } }] }, sort: 'id', ...o })).docs as Doc[]
    const byHolder = new Map<number, { holder: Doc; waiting: Doc[] }>()
    for (const t of flagged) {
      const holder = await fastLaneHolderDoc(payload, t)
      if (holder) byHolder.set(holder.id, { holder, waiting: [...(byHolder.get(holder.id)?.waiting ?? []), t] })
    }
    for (const { holder, waiting } of byHolder.values()) {
      holds.push({ kind: 'fast-lane', text: fastLaneText(holder.number), holder: ref(holder), waiting: waiting.map(ref), href: `/tickets/${holder.id}` })
    }
  }

  const queued = (await payload.find({ collection: 'tickets', where: { and: [...open, { waitingFor: { exists: true } }] }, sort: 'id', ...o })).docs as Doc[]
  const unblocked = queued.filter((t) => !((t.blockedBy as Doc[]) ?? []).some((b) => b.state !== 'closed'))

  const ws = await payload.findByID({ collection: 'workspaces', id: workspace, select: { wipLimits: true }, depth: 0, overrideAccess: true })
  for (const stage of heldStages(wf)) {
    const waiting = unblocked.filter((t) => t.waitingFor === stage && !t.waitingReason)
    const limit = wipLimit(ws, stage, wf)
    if (!waiting.length || limit == null) continue
    const count = await wipCount(payload, workspace, stage)
    holds.push({ kind: 'wip', text: `${title(wf, stage)} is full (${count}/${limit})`, stage, count, limit, waiting: waiting.map(ref), href: `/?stage=${encodeURIComponent(stage)}` })
  }

  const build = byKind(wf, 'build')?.name
  const overlapped = new Map<string, Doc[]>()
  for (const t of unblocked) {
    const n = t.waitingFor === build ? OVERLAP.exec(t.waitingReason ?? '')?.[1] : undefined
    if (n) overlapped.set(`${id(t.product)}:${n}`, [...(overlapped.get(`${id(t.product)}:${n}`) ?? []), t])
  }
  for (const [key, waiting] of overlapped) {
    const [product, n] = key.split(':').map(Number)
    const [holder] = (await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { product: { equals: product } }, { number: { equals: n } }] }, limit: 1, ...o })).docs as Doc[]
    if (holder) holds.push({ kind: 'overlap', text: overlapText(title(wf, build!), n), stage: build!, holder: ref(holder), waiting: waiting.map(ref), href: `/tickets/${holder.id}` })
  }

  const parked = (await payload.find({ collection: 'runs', where: { and: [{ workspace: { equals: workspace } }, { status: { equals: 'awaiting_session' } }] }, depth: 0, overrideAccess: true, pagination: false })).docs as Doc[]
  const byRole = new Map<string, Doc[]>()
  for (const r of parked) if (r.role) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r])
  for (const [role, runs] of byRole) {
    if ((await connectedOfRole(payload, workspace, role)) > 0) continue
    const tickets = (await payload.find({ collection: 'tickets', where: { id: { in: runs.map((r) => id(r.ticket)) } }, ...o })).docs as Doc[]
    const name = wf.roles.find((r) => r.id === role)?.title ?? role
    holds.push({ kind: 'no-agent', role, text: `No ${name} agent is connected, ${runs.length} ${runs.length === 1 ? 'Run waits' : 'Runs wait'}`, waiting: tickets.map(ref), href: `/team?role=${encodeURIComponent(role)}` })
  }
  return holds
}
