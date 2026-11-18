import type { Payload, Where } from 'payload'
import { workflowFor } from './factory'
import { fastLaneHolderDoc, laneOn } from './expedite'
import { fastLaneText, overlapText } from './hold-text'
import { executorsOf } from './executors'
import { connectedOfRole } from './presence'
import { id } from './release'
import { loadTeam } from './sessions'
import { wipCount } from './wip'
import { wipLimit } from './wip-limits'
import { byKind, heldStages, title, wipStages } from './workflow'

type Doc = Record<string, any>
const o = { depth: 1, overrideAccess: true, pagination: false } as const

export type HoldTicket = { id: number; number: number; href: string }
export type Hold = { text: string; waiting: HoldTicket[]; href: string; causes?: { stage: string; line: string; action: { label: string; href: string } | null }[] } & (
  | { kind: 'fast-lane'; holder: HoldTicket }
  | { kind: 'wip'; stage: string; count: number; limit: number }
  | { kind: 'parked'; stage: string }
  | { kind: 'overlap'; holder: HoldTicket; stage: string }
  | { kind: 'no-agent'; role: string }
  | { kind: 'cannot-run'; stages: string[] }
)

const ref = (t: Doc): HoldTicket => ({ id: t.id, number: t.number, href: `/tickets/${t.id}` })
const OVERLAP = /^overlaps #(\d+)$/

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

  const parkedDocs = (await payload.find({ collection: 'tickets', where: { and: [...open, { parkedNeed: { exists: true } }] }, sort: 'id', ...o })).docs as Doc[]
  for (const stage of wipStages(wf)) {
    const parked = parkedDocs.filter((t) => t.stage === stage)
    if (parked.length) holds.push({ kind: 'parked', text: `${parked.length} parked Ticket${parked.length === 1 ? '' : 's'} not counted in ${title(wf, stage)}`, stage, waiting: parked.map(ref), href: `/?stage=${encodeURIComponent(stage)}` })
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

  const executors = await executorsOf(payload, workspace, wf.stages, (await loadTeam(payload, workspace)).roles)
  const stuck = [...executors].filter(([, e]) => e.cannotRun).map(([stage]) => stage)
  const idle = stuck.length ? ((await payload.find({ collection: 'tickets', where: { and: [...open, { stage: { in: stuck } }, { needsYou: { exists: false } }, { parkedNeed: { exists: false } }] }, sort: 'id', ...o })).docs as Doc[]) : []
  const cannot = stuck.filter((stage) => idle.some((t) => t.stage === stage))
  if (cannot.length) {
    holds.push({ kind: 'cannot-run', stages: cannot, text: `${cannot.length} stage${cannot.length === 1 ? '' : 's'} cannot run`, waiting: idle.map(ref), href: '/', causes: cannot.map((stage) => ({ stage: title(wf, stage), line: executors.get(stage)!.line, action: executors.get(stage)!.action })) })
  }
  return holds
}
