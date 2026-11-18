import { cache } from 'react'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { hasProductionChecks } from '../../../lib/mode'
import { nextStep } from '../../../lib/next-step'
import { productGates } from '../../../lib/staging'
import { payloadClient } from './session'
import { type Stage, needsOf, stageOf } from './needs-you'
import { type Epic, epicWhere } from './epics'
import { wipCounts } from '../../../lib/wip'
import { fastLaneHolder } from '../../../lib/expedite'
import { fastLaneText, overlapText } from '../../../lib/hold-text'
import { waitingText, wipLimit } from '../../../lib/wip-limits'
import { workflowFor } from '../../../lib/factory'
import { byKind, is, stage as stageDef, title, wipStages, type Workflow } from '../../../lib/workflow'
import { jobsOpen } from '../../../lib/stage-jobs'
import { parkedWhyOf, statusLine, type Track } from './status'
import type { EpicField, SliceField } from '../../../lib/epic'

export type RunRow = {
  id: number
  ticket: number
  stage: string
  kind?: string | null
  job?: string | null
  status: string
  error?: string | null
  mode: string
  sessionOwner: number | null
  heartbeatAt: string | null
  startedAt: string | null
  finishedAt: string | null
  costUsd: number | null
  reconcileStatus?: string | null
  gatewayTokensTotal?: number | null
  createdAt: string
  investigation?: unknown
  escalation?: { step: number; reason: string } | null
  reasonKind?: string | null
  preemptedFor?: number | null
  executor?: string | null
  role?: string | null
  sessionLabel?: string | null
  clientName?: string | null
  clientVersion?: string | null
  model?: string | null
  provider?: string | null
}
import { KINDS, type Kind } from '../../../lib/intake/kinds'
export const kindOfLabels = (labels: readonly string[] | null | undefined): Kind | null => {
  const k = labels?.find((l) => l.startsWith('bauherr:type:'))?.slice(13)
  return KINDS.find((x) => x === k) ?? null
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
  expedite: boolean
  kind: Kind | null
  releasedIn: string | null
  product: { id: number; name: string } | null
  run: RunRow | null
  owner: string | null
  needsYou: string | null
  gate: { people: string[]; since: string } | null
  gateUnreachable: string | null
  blockedBy: { id: number; number: number }[]
  overlaps: number | null
  waiting: string | null
  queuedWhy: string | null
  forge: 'github' | 'gitlab' | null
  track: Track
  children: { total: number; done: number } | null
  enteredAt: string
  parent: { id: number; number: number; title: string } | null
  epic: { total: number; passed: number } | null
  slicing: { index: number; total: number; stage: Stage | null } | null
  slice: { index: number; total: number } | null
  parked: boolean
  parkedWhy: string | null
}

const LIVE = ['running', 'awaiting_session']
export const RUNS_LIMIT = 100
const CLOSED_LIMIT = 200
export const FORGE_TIMEOUT_MS = 3000
const RUN_FIELDS = { ticket: true, stage: true, kind: true, job: true, status: true, error: true, mode: true, sessionOwner: true, heartbeatAt: true, startedAt: true, finishedAt: true, costUsd: true, reconcileStatus: true, gatewayTokensTotal: true, createdAt: true, escalation: true, investigation: true, reasonKind: true, preemptedFor: true, executor: true, role: true, sessionLabel: true, clientName: true, clientVersion: true, model: true, provider: true } as const

export { within } from '../../../lib/within'

type Base = { tickets: TicketRow[]; runs: RunRow[]; runsTotal: number; products: { id: number; name: string }[]; epics: Epic[]; wip: Record<string, { count: number; parked: number; limit: number | null }> }
type Doc = Record<string, any>
const q = { depth: 0, overrideAccess: true } as const

const docsOf = async (payload: Payload, collection: string, extra: object): Promise<Doc[]> => ((await payload.find({ collection, pagination: false, ...q, ...extra } as never)).docs as unknown as Doc[])

const latestRuns = async (payload: Payload, tickets: number[]): Promise<Map<number, RunRow>> => {
  if (!tickets.length) return new Map()
  const ids = (await payload.db.drizzle.execute(sql`SELECT DISTINCT ON ("ticket_id") "id" FROM "runs" WHERE "ticket_id" IN (${sql.join(tickets.map((t) => sql`${t}`), sql`, `)}) ORDER BY "ticket_id", "created_at" DESC, "id" DESC`)).rows.map((r) => r.id as number)
  return new Map((await docsOf(payload, 'runs', { where: { id: { in: ids } }, select: RUN_FIELDS }) as unknown as RunRow[]).map((r) => [r.ticket, r]))
}

export const forgeKinds = async (payload: Payload, workspace: number): Promise<Map<number, 'github' | 'gitlab'>> =>
  new Map((await payload.db.drizzle.execute(sql`SELECT s."product_id" AS product, c."kind" AS kind FROM "ticket_sources" s JOIN "connections" c ON c."id" = s."connection_id" WHERE s."workspace_id" = ${workspace}`)).rows.map((r) => [r.product as number, r.kind as 'github' | 'gitlab']))

const stageEntries = async (payload: Payload, tickets: number[]): Promise<Map<number, string>> =>
  !tickets.length ? new Map() : new Map((await payload.db.drizzle.execute(sql`SELECT DISTINCT ON ("ticket_id") "ticket_id" AS ticket, "at" FROM "ticket_events" WHERE "ticket_id" IN (${sql.join(tickets.map((t) => sql`${t}`), sql`, `)}) AND "stage" IS NOT NULL AND COALESCE("cause", '') NOT LIKE 'skip:%' AND COALESCE("cause", '') NOT LIKE 'job:%' AND "from_stage" IS DISTINCT FROM "stage" ORDER BY "ticket_id", "at" DESC, "id" DESC`)).rows.map((r) => [r.ticket as number, new Date(r.at as string).toISOString()]))

const rowsOf = async (payload: Payload, workspace: number, ticketDocs: Doc[], productRows: { id: number; name: string; productionChecks?: string | null; productOwnerTestsStaging?: boolean | null }[], wip: Base['wip']): Promise<TicketRow[]> => {
  const ws = { workspace: { equals: workspace } }
  const wf = workflowFor(workspace)
  const buildStage = byKind(wf, 'build')?.name
  const blockerIds = [...new Set(ticketDocs.flatMap((t) => (t.blockedBy ?? []) as number[]))]
  const parentIds = [...new Set(ticketDocs.flatMap((t) => (t.parent ? [t.parent as number] : [])))]
  const tickets = (ids: number[]) => (ids.length ? docsOf(payload, 'tickets', { where: { and: [ws, { id: { in: ids } }] } }) : [])
  const ids = ticketDocs.map((t) => t.id as number)
  const containerIds = ticketDocs.filter((t) => t.epic || is(wf, stageOf(wf, t), 'container')).map((t) => t.id as number)
  const [blockerDocs, parentDocs, [latest, owners], forges, entered, kids, fastLanes] = await Promise.all([
    tickets(blockerIds),
    tickets(parentIds),
    (async () => {
      const latest = await latestRuns(payload, ticketDocs.map((t) => t.id))
      const ownerIds = [...new Set([...latest.values()].filter((r) => LIVE.includes(r.status) && r.mode === 'session' && r.sessionOwner).map((r) => r.sessionOwner!))]
      return [latest, new Map(ownerIds.length ? (await docsOf(payload, 'bauherren', { where: { id: { in: ownerIds } } })).map((o) => [o.id as number, String(o.email).split('@')[0]] as const) : [])] as const
    })(),
    forgeKinds(payload, workspace),
    stageEntries(payload, ids),
    containerIds.length ? docsOf(payload, 'tickets', { where: { and: [ws, { parent: { in: containerIds } }] }, select: { parent: true, state: true, stage: true, slice: true } }) : [],
    Promise.all(ticketDocs.filter((t) => t.state !== 'closed' && t.expedite).map(async (t) => [t.id as number, await fastLaneHolder(payload, t)] as const)).then((rows) => new Map(rows)),
  ])
  const blockers = new Map(blockerDocs.map((b) => [b.id as number, { id: b.id as number, number: b.number as number, open: b.state !== 'closed' }]))
  const parents = new Map(parentDocs.map((p) => [p.id as number, { id: p.id as number, number: p.number as number, title: p.title as string }]))
  const epicTotals = new Map(parentDocs.filter((p) => p.epic).map((p) => [p.id as number, (p.epic as EpicField).slices.length]))
  const slicingOf = (t: Doc): TicketRow['slicing'] => {
    const e = t.epic as EpicField | null
    if (!e || !is(wf, stageOf(wf, t), 'container')) return null
    const sub = kids.find((k) => k.id === e.slices[e.current]?.ticket)
    return { index: e.current + 1, total: e.slices.length, stage: sub ? stageOf(wf, sub) : null }
  }
  const passedOf = (t: Doc) => kids.filter((k) => k.parent === t.id && k.slice?.passed).length
  const byId = new Map(productRows.map((p) => [p.id, p]))
  const gatesFor = await productGates(payload, wf, workspace, productRows)
  const jobsOpenIds = new Set((await Promise.all(ticketDocs.filter((t) => t.state !== 'closed' && stageDef(wf, t.stage)?.jobs).map(async (t) => ((await jobsOpen(payload, t)) ? t.id : null)))).filter((x) => x !== null))
  return ticketDocs.map((t): TicketRow => {
    const isOpen = t.state !== 'closed'
    const run = latest.get(t.id) ?? null
    const blockedBy = isOpen ? ((t.blockedBy ?? []) as number[]).flatMap((b) => (blockers.get(b)?.open ? [blockers.get(b)!] : [])) : []
    const need = needsOf(wf, { ...t, jobsOpen: jobsOpenIds.has(t.id) }, run, !hasProductionChecks(byId.get(t.product) ?? {}), gatesFor(t.product))
    const overlap = isOpen && t.waitingFor === buildStage ? /^overlaps #(\d+)$/.exec(t.waitingReason ?? '')?.[1] : undefined
    const hold = isOpen && t.waitingFor && !blockedBy.length ? waitingText(wf, t.waitingFor, wip[t.waitingFor]?.count ?? 0, wip[t.waitingFor]?.limit ?? null, t.waitingReason).replace(/^Waiting: /, '') : null
    return {
      id: t.id,
      number: t.number,
      title: t.title,
      url: t.url ?? null,
      open: isOpen,
      stage: stageOf(wf, t),
      rank: t.rank ?? null,
      reviewRounds: t.reviewRounds ?? 0,
      expedite: isOpen && !!t.expedite,
      kind: kindOfLabels(t.labels),
      releasedIn: t.releasedIn ?? null,
      product: byId.get(t.product) ? { id: byId.get(t.product)!.id, name: byId.get(t.product)!.name } : null,
      run,
      owner: run?.sessionOwner ? (owners.get(run.sessionOwner) ?? null) : null,
      needsYou: need,
      waiting: isOpen && t.waitingFor && !blockedBy.length ? nextStep({ wf, ticket: t, need: null, run: null, waiting: waitingText(wf, t.waitingFor, wip[t.waitingFor]?.count ?? 0, wip[t.waitingFor]?.limit ?? null, t.waitingReason), blockers: [], admin: false }).reason : null,
      overlaps: overlap ? Number(overlap) || null : null,
      queuedWhy: overlap ? overlapText(title(wf, buildStage!), Number(overlap)) : fastLanes.get(t.id) ? fastLaneText(fastLanes.get(t.id)!) : t.waitingFor === 'checks' ? null : hold,
      forge: forges.get(t.product) ?? null,
      track: { waitingFor: t.waitingFor, reviewState: t.reviewState, releaseState: t.releaseState, productionState: t.productionState, releaseChecksState: t.releaseChecksState, releaseError: t.releaseError },
      epic: t.epic ? { total: (t.epic as EpicField).slices.length, passed: passedOf(t) } : null,
      slicing: slicingOf(t),
      parked: isOpen && !!t.parked,
      parkedWhy: isOpen ? parkedWhyOf(t) : null,
      slice: t.slice && epicTotals.has(t.parent) ? { index: (t.slice as SliceField).index + 1, total: epicTotals.get(t.parent)! } : null,
      children: !containerIds.includes(t.id) ? null : t.epic ? { total: (t.epic as EpicField).slices.length, done: passedOf(t) } : { total: kids.filter((k) => k.parent === t.id).length, done: kids.filter((k) => k.parent === t.id && k.state === 'closed').length },
      enteredAt: entered.get(t.id) ?? t.updatedAt,
      parent: parents.get(t.parent) ?? null,
      gate: isOpen && t.gateNotifiedAt ? { people: String(t.gateAssignees ?? '').split(',').filter(Boolean), since: t.gateNotifiedAt } : null,
      gateUnreachable: isOpen && !t.gateNotifiedAt ? (t.gateUnreachable ?? null) : null,
      blockedBy,
    }
  })
}

const epicOf = (wf: Workflow, e: Doc, subs: Doc[], byRow: Map<number, TicketRow>): Epic => {
  const children = subs.filter((c) => c.parent === e.id).map((c) => { const r = byRow.get(c.id); return { id: c.id, number: c.number, title: c.title, stage: stageOf(wf, c), open: c.state !== 'closed', status: r ? statusLine(wf, r) : 'Done' } })
  const plan = e.epic as EpicField | null
  return {
    id: e.id, number: e.number, title: e.title, open: e.state !== 'closed', parked: e.state !== 'closed' && !!e.parked, rank: e.rank ?? null, product: e.product ?? null, children,
    ...(plan && {
      slices: plan.slices.map((s) => ({ title: s.title, child: children.find((c) => c.id === s.ticket) ?? null, passed: !!subs.find((c) => c.id === s.ticket)?.slice?.passed })),
      current: is(wf, stageOf(wf, e), 'container') ? plan.current : null,
    }),
  }
}

export const loadOverviewRows = cache(async (workspace: number, all: boolean): Promise<Base> => {
  const wf = workflowFor(workspace)
  const payload = await payloadClient()
  const ws = { workspace: { equals: workspace } }
  const [open, closed, recent, products, wsDoc, subs, counts] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [ws, { state: { equals: 'open' } }] }, sort: '-sourceUpdatedAt', pagination: false, ...q }),
    all ? payload.find({ collection: 'tickets', where: { and: [ws, { state: { equals: 'closed' } }] }, sort: '-updatedAt', limit: CLOSED_LIMIT, ...q }) : null,
    payload.find({ collection: 'runs', where: ws, sort: '-createdAt', limit: RUNS_LIMIT, select: RUN_FIELDS, ...q }),
    payload.find({ collection: 'products', where: ws, sort: 'name', pagination: false, ...q }),
    payload.findByID({ collection: 'workspaces', id: workspace, select: { wipLimits: true }, ...q }),
    docsOf(payload, 'tickets', { where: { and: [ws, { parent: { exists: true } }] }, sort: 'number' }),
    wipCounts(payload, workspace),
  ])
  const ticketDocs = [...open.docs, ...(closed?.docs ?? [])] as unknown as Doc[]
  const runRows = recent.docs as unknown as RunRow[]
  const known = new Set(ticketDocs.map((t) => t.id))
  const missing = [...new Set(runRows.map((r) => r.ticket))].filter((id) => !known.has(id))
  if (missing.length) ticketDocs.push(...(await docsOf(payload, 'tickets', { where: { and: [ws, { id: { in: missing } }] } })))
  const wip = Object.fromEntries(wipStages(wf).map((s) => [s, { ...counts[s]!, limit: wipLimit(wsDoc, s, wf) }]))
  const productRows = products.docs as unknown as { id: number; name: string; productionChecks?: string | null }[]
  const [rows, epicDocs] = await Promise.all([rowsOf(payload, workspace, ticketDocs, productRows, wip), docsOf(payload, 'tickets', { where: { and: [ws, epicWhere(wf, [...new Set(subs.map((c) => c.parent as number))])] } })])
  const byRow = new Map(rows.map((r) => [r.id, r]))
  return { tickets: rows, runs: runRows, runsTotal: recent.totalDocs, products: productRows, epics: epicDocs.map((e) => epicOf(wf, e, subs, byRow)), wip }
})

export const loadOverview = loadOverviewRows

export const loadEpic = async (workspace: number, ticket: Doc): Promise<Epic | null> => {
  const wf = workflowFor(workspace)
  const payload = await payloadClient()
  const ws = { workspace: { equals: workspace } }
  const [subs, products, wsDoc, counts] = await Promise.all([
    docsOf(payload, 'tickets', { where: { and: [ws, { parent: { equals: ticket.id } }] }, sort: 'number' }),
    docsOf(payload, 'products', { where: ws, select: { name: true, productionChecks: true, productOwnerTestsStaging: true } }),
    payload.findByID({ collection: 'workspaces', id: workspace, select: { wipLimits: true }, ...q }),
    wipCounts(payload, workspace),
  ])
  if (!subs.length && !is(wf, ticket.stage, 'container')) return null
  const rows = await rowsOf(payload, workspace, subs, products as never, Object.fromEntries(wipStages(wf).map((s) => [s, { ...counts[s]!, limit: wipLimit(wsDoc, s, wf) }])))
  return epicOf(wf, ticket, subs, new Map(rows.map((r) => [r.id, r])))
}
