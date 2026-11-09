import { cache } from 'react'
import { ticketsOf } from '../../../lib/actions'
import { hasProductionChecks } from '../../../lib/mode'
import { nextStep } from '../../../lib/next-step'
import { unansweredCriticalCount } from './plan'
import { payloadClient } from './session'
import { type Stage, needsYou, stageOf } from './needs-you'
import { type Epic, epicWhere, plainStatus } from './epics'
import { wipCounts } from '../../../lib/wip'
import { WIP_STAGES, waitingText, wipLimit } from '../../../lib/wip-limits'

export type RunRow = {
  id: number
  ticket: number
  stage: string
  status: string
  /** Why the Run ended (failed, cancelled, needs_human). */
  error?: string | null
  mode: string
  sessionOwner: number | null
  heartbeatAt: string | null
  startedAt: string | null
  finishedAt: string | null
  costUsd: number | null
  createdAt: string
  /** Set on an investigation Plan Run. */
  investigation?: unknown
  /** Set on an escalated Run: { step, reason, previousRuns }. */
  escalation?: { step: number; reason: string } | null
  reasonKind?: string | null
}
export type TicketRow = {
  id: number
  number: number
  title: string
  url: string | null
  open: boolean
  stage: Stage
  rank: string | null
  reviewRounds: number
  /** Hotfix: the Expedite lane serves this open Ticket. */
  expedite: boolean
  /** Tag of the release the Ticket shipped in, e.g. v0.2.0. */
  releasedIn: string | null
  product: { id: number; name: string } | null
  run: RunRow | null
  /** Email local-part of the session owner of a live Run; null for scheduler Runs. */
  owner: string | null
  needsYou: string | null
  /** Who the gate notified and since when; null before the notify job ran. */
  gate: { people: string[]; since: string } | null
  gateUnreachable: string | null
  /** Open Tickets this one is blocked by. */
  blockedBy: { id: number; number: number }[]
  /** Number of the Ticket whose paths hold this Build, else null. */
  overlaps: number | null
  /** "Queued for Build: Build is full (2/2). Starts by itself." (`nextStep` reason) while the Ticket waits for a full column; null otherwise. */
  waiting: string | null
  /** Parent Ticket of a sub-ticket. */
  parent: { id: number; number: number; title: string } | null
}

const LIVE = ['running', 'awaiting_session']
export const RUNS_LIMIT = 100
/** Plan comments are fetched from the forge only for tickets awaiting plan approval, at most this many per load. */
export const DECISIONS_LOOKUPS = 20
const CLOSED_LIMIT = 200
export const FORGE_TIMEOUT_MS = 3000
const RUN_FIELDS = { ticket: true, stage: true, status: true, error: true, mode: true, sessionOwner: true, heartbeatAt: true, startedAt: true, finishedAt: true, costUsd: true, createdAt: true, escalation: true, investigation: true, reasonKind: true } as const

export const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => AbortSignal.timeout(ms).addEventListener('abort', () => reject(new Error('forge timeout'))))])

type Base = { tickets: TicketRow[]; runs: RunRow[]; runsTotal: number; products: { id: number; name: string }[]; epics: Epic[]; wip: Record<string, { count: number; limit: number | null }> }

/** Everything of `loadOverview` that needs only the database (no forge call): enough for counts and epics, which the top bar and the Ticket page need on every request. */
export const loadOverviewRows = cache(async (workspace: number, all: boolean): Promise<Base & { planLookups: { id: number; number: number; product: number }[] }> => {
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const ws = { workspace: { equals: workspace } }
  const [open, closed, recent, products, wsDoc] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [ws, { state: { equals: 'open' } }] }, sort: '-sourceUpdatedAt', pagination: false, ...q }),
    all ? payload.find({ collection: 'tickets', where: { and: [ws, { state: { equals: 'closed' } }] }, sort: '-updatedAt', limit: CLOSED_LIMIT, ...q }) : null,
    payload.find({ collection: 'runs', where: ws, sort: '-createdAt', limit: RUNS_LIMIT, select: RUN_FIELDS, ...q }),
    payload.find({ collection: 'products', where: ws, sort: 'name', pagination: false, ...q }),
    payload.findByID({ collection: 'workspaces', id: workspace, select: { wipLimits: true }, ...q }),
  ])
  const ticketDocs = [...open.docs, ...(closed?.docs ?? [])] as unknown as Record<string, any>[]
  const runRows = recent.docs as unknown as RunRow[]
  const known = new Set(ticketDocs.map((t) => t.id))
  const missing = [...new Set(runRows.map((r) => r.ticket))].filter((id) => !known.has(id))
  if (missing.length) {
    const extra = await payload.find({ collection: 'tickets', where: { and: [ws, { id: { in: missing } }] }, pagination: false, ...q })
    ticketDocs.push(...(extra.docs as unknown as Record<string, any>[]))
  }
  const blockerIds = [...new Set(ticketDocs.flatMap((t) => (t.blockedBy ?? []) as number[]))]
  const parentIds = [...new Set(ticketDocs.flatMap((t) => (t.parent ? [t.parent as number] : [])))]
  const docsOf = async (collection: string, extra: object): Promise<Record<string, any>[]> => ((await payload.find({ collection, pagination: false, ...q, ...extra } as never)).docs as unknown as Record<string, any>[])
  const tickets = (where: object, sort?: string) => docsOf('tickets', { where: { and: [ws, where] }, sort })
  const owned = async (latest: Map<number, RunRow>): Promise<Map<number, string>> => {
    const ownerIds = [...new Set([...latest.values()].filter((r) => LIVE.includes(r.status) && r.mode === 'session' && r.sessionOwner).map((r) => r.sessionOwner!))]
    return new Map(ownerIds.length ? (await docsOf('bauherren', { where: { id: { in: ownerIds } } })).map((o) => [o.id as number, String(o.email).split('@')[0]] as const) : [])
  }
  const [blockerDocs, parentDocs, [latest, owners], subs, counts] = await Promise.all([
    blockerIds.length ? tickets({ id: { in: blockerIds } }) : [],
    parentIds.length ? tickets({ id: { in: parentIds } }) : [],
    (async () => {
      const latest = new Map<number, RunRow>()
      if (ticketDocs.length) for (const r of (await docsOf('runs', { where: { ticket: { in: ticketDocs.map((t) => t.id) } }, sort: '-createdAt', select: RUN_FIELDS })) as unknown as RunRow[]) if (!latest.has(r.ticket)) latest.set(r.ticket, r)
      return [latest, await owned(latest)] as const
    })(),
    tickets({ parent: { exists: true } }, 'number'),
    wipCounts(payload, workspace),
  ])
  const wip = Object.fromEntries(WIP_STAGES.map((s) => [s, { count: counts[s], limit: wipLimit(wsDoc, s) }]))
  const blockers = new Map(blockerDocs.map((b) => [b.id as number, { id: b.id as number, number: b.number as number, open: b.state !== 'closed' }]))
  const parents = new Map(parentDocs.map((p) => [p.id as number, { id: p.id as number, number: p.number as number, title: p.title as string }]))
  const epicDocs = await tickets(epicWhere([...new Set(subs.map((c) => c.parent as number))]))
  const productRows = products.docs as unknown as { id: number; name: string; productionChecks?: string | null }[]
  const byId = new Map(productRows.map((p) => [p.id, p]))
  const rows = ticketDocs.map((t): TicketRow => {
    const isOpen = t.state !== 'closed'
    const run = latest.get(t.id) ?? null
    const blockedBy = isOpen ? ((t.blockedBy ?? []) as number[]).flatMap((b) => (blockers.get(b)?.open ? [blockers.get(b)!] : [])) : []
    return {
      id: t.id,
      number: t.number,
      title: t.title,
      url: t.url ?? null,
      open: isOpen,
      stage: stageOf(t),
      rank: t.rank ?? null,
      reviewRounds: t.reviewRounds ?? 0,
      expedite: isOpen && !!t.expedite,
      releasedIn: t.releasedIn ?? null,
      product: byId.get(t.product) ? { id: byId.get(t.product)!.id, name: byId.get(t.product)!.name } : null,
      run,
      owner: run?.sessionOwner ? (owners.get(run.sessionOwner) ?? null) : null,
      needsYou: isOpen || t.releaseChecksState === 'failed' ? needsYou({ stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState, productionState: t.productionState, productionChecksMissing: !hasProductionChecks(byId.get(t.product) ?? {}), releaseChecksState: t.releaseChecksState, reviewState: t.reviewState, reviewRounds: t.reviewRounds, expedite: t.expedite }, run) : null,
      waiting: isOpen && t.waitingFor && !blockedBy.length ? nextStep({ ticket: t, need: null, run: null, waiting: waitingText(t.waitingFor, wip[t.waitingFor]?.count ?? 0, wip[t.waitingFor]?.limit ?? null, t.waitingReason), blockers: [], admin: false }).reason : null,
      overlaps: isOpen && t.waitingFor === 'build' ? Number(/^overlaps #(\d+)$/.exec(t.waitingReason ?? '')?.[1]) || null : null,
      parent: parents.get(t.parent) ?? null,
      gate: isOpen && t.gateNotifiedAt ? { people: String(t.gateAssignees ?? '').split(',').filter(Boolean), since: t.gateNotifiedAt } : null,
      gateUnreachable: isOpen && !t.gateNotifiedAt ? (t.gateUnreachable ?? null) : null,
      blockedBy,
    }
  })
  const byRow = new Map(rows.map((r) => [r.id, r]))
  const epics = epicDocs.map((e): Epic => ({
    id: e.id, number: e.number, title: e.title, open: e.state !== 'closed', rank: e.rank ?? null, product: e.product ?? null,
    children: subs.filter((c) => c.parent === e.id).map((c) => { const r = byRow.get(c.id); return { id: c.id, number: c.number, title: c.title, stage: stageOf(c), open: c.state !== 'closed', status: r ? plainStatus(r) : 'Done' } }),
  }))
  const planLookups = rows.filter((r) => r.needsYou === 'Approve plan').slice(0, DECISIONS_LOOKUPS).map((r) => ({ id: r.id, number: r.number, product: ticketDocs.find((t) => t.id === r.id)!.product as number }))
  return { tickets: rows, runs: runRows, runsTotal: recent.totalDocs, products: productRows, epics, wip, planLookups }
})

/** `loadOverviewRows` plus the forge lookup that turns "Approve plan" into "Answer decisions" (3 s each, in parallel). Only the Board and Runs pages show that difference; the count of Tickets that need you is the same without it. */
export const loadOverview = cache(async (workspace: number, all: boolean): Promise<Base> => {
  const { planLookups, ...base } = await loadOverviewRows(workspace, all)
  const payload = await payloadClient()
  const sources = new Map<number, ReturnType<typeof ticketsOf>>()
  const answer = new Set<number>()
  await Promise.all(
    planLookups.map(async ({ id, number, product }) => {
      try {
        if (!sources.has(product)) sources.set(product, ticketsOf(payload, product))
        const ts = await sources.get(product)!
        if (unansweredCriticalCount(await within(ts.listComments(String(number)), FORGE_TIMEOUT_MS))) answer.add(id)
      } catch {
        // forge unreachable or slow: keep "Approve plan"
      }
    }),
  )
  return answer.size ? { ...base, tickets: base.tickets.map((t) => (answer.has(t.id) ? { ...t, needsYou: 'Answer decisions' } : t)) } : base
})
