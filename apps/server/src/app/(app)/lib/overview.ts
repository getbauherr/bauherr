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
import { fastLaneText } from '../../../lib/hold-text'
import { waitingText, wipLimit } from '../../../lib/wip-limits'
import { workflowFor } from '../../../lib/factory'
import { byKind, is, wipStages, type Workflow } from '../../../lib/workflow'
import { statusLine, type Track } from './status'

export type RunRow = {
  id: number
  ticket: number
  stage: string
  kind?: string | null
  status: string
  /** Why the Run ended (failed, cancelled, needs_human). */
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
  /** Set on an investigation Plan Run. */
  investigation?: unknown
  /** Set on an escalated Run: { step, reason, previousRuns }. */
  escalation?: { step: number; reason: string } | null
  reasonKind?: string | null
  executor?: string | null
  role?: string | null
  sessionLabel?: string | null
  clientName?: string | null
  clientVersion?: string | null
  model?: string | null
  provider?: string | null
}
import { KINDS, type Kind } from '../../../lib/intake/kinds'
/** The type of a Ticket from its `bauherr:type:<kind>` label (null for tickets that did not come from a typed request). */
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
  /** Hotfix: the Expedite lane serves this open Ticket. */
  expedite: boolean
  /** The request's type from its `bauherr:type:<kind>` label; null for a ticket nobody typed. */
  kind: Kind | null
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
  /** The bare reason of `waiting` ("Build is full (2/2)", "waits for #12, which changes the same files"). */
  queuedWhy: string | null
  /** Kind of the Product's forge Connection; names who runs the checks. */
  forge: 'github' | 'gitlab' | null
  /** What the factory waits for between Runs (`phaseOf` reads the same fields). */
  track: Track
  /** Sub-tickets of a split Ticket; null otherwise. */
  children: { total: number; done: number } | null
  /** When the Ticket entered its stage: the latest stage-change event, else the Ticket's last update. */
  enteredAt: string
  /** Parent Ticket of a sub-ticket. */
  parent: { id: number; number: number; title: string } | null
}

const LIVE = ['running', 'awaiting_session']
export const RUNS_LIMIT = 100
const CLOSED_LIMIT = 200
export const FORGE_TIMEOUT_MS = 3000
const RUN_FIELDS = { ticket: true, stage: true, kind: true, status: true, error: true, mode: true, sessionOwner: true, heartbeatAt: true, startedAt: true, finishedAt: true, costUsd: true, reconcileStatus: true, gatewayTokensTotal: true, createdAt: true, escalation: true, investigation: true, reasonKind: true, executor: true, role: true, sessionLabel: true, clientName: true, clientVersion: true, model: true, provider: true } as const

export const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => AbortSignal.timeout(ms).addEventListener('abort', () => reject(new Error('forge timeout'))))])

type Base = { tickets: TicketRow[]; runs: RunRow[]; runsTotal: number; products: { id: number; name: string }[]; epics: Epic[]; wip: Record<string, { count: number; limit: number | null }> }
type Doc = Record<string, any>
const q = { depth: 0, overrideAccess: true } as const

const docsOf = async (payload: Payload, collection: string, extra: object): Promise<Doc[]> => ((await payload.find({ collection, pagination: false, ...q, ...extra } as never)).docs as unknown as Doc[])

/** The newest Run of each Ticket (one `DISTINCT ON` query for the ids, then the Run fields), never all Runs of the Tickets. */
const latestRuns = async (payload: Payload, tickets: number[]): Promise<Map<number, RunRow>> => {
  if (!tickets.length) return new Map()
  const ids = (await payload.db.drizzle.execute(sql`SELECT DISTINCT ON ("ticket_id") "id" FROM "runs" WHERE "ticket_id" IN (${sql.join(tickets.map((t) => sql`${t}`), sql`, `)}) ORDER BY "ticket_id", "created_at" DESC, "id" DESC`)).rows.map((r) => r.id as number)
  return new Map((await docsOf(payload, 'runs', { where: { id: { in: ids } }, select: RUN_FIELDS }) as unknown as RunRow[]).map((r) => [r.ticket, r]))
}

/** Kind of the forge Connection per Product id. */
export const forgeKinds = async (payload: Payload, workspace: number): Promise<Map<number, 'github' | 'gitlab'>> =>
  new Map((await payload.db.drizzle.execute(sql`SELECT s."product_id" AS product, c."kind" AS kind FROM "ticket_sources" s JOIN "connections" c ON c."id" = s."connection_id" WHERE s."workspace_id" = ${workspace}`)).rows.map((r) => [r.product as number, r.kind as 'github' | 'gitlab']))

/** The newest stage-change event of each Ticket: when it entered its current stage. */
const stageEntries = async (payload: Payload, tickets: number[]): Promise<Map<number, string>> =>
  !tickets.length ? new Map() : new Map((await payload.db.drizzle.execute(sql`SELECT DISTINCT ON ("ticket_id") "ticket_id" AS ticket, "at" FROM "ticket_events" WHERE "ticket_id" IN (${sql.join(tickets.map((t) => sql`${t}`), sql`, `)}) AND "stage" IS NOT NULL AND COALESCE("cause", '') NOT LIKE 'skip:%' AND "from_stage" IS DISTINCT FROM "stage" ORDER BY "ticket_id", "at" DESC, "id" DESC`)).rows.map((r) => [r.ticket as number, new Date(r.at as string).toISOString()]))

/** Board rows of `ticketDocs`: their blockers, parents, newest Run and its owner, in two parallel rounds. Database only. */
const rowsOf = async (payload: Payload, workspace: number, ticketDocs: Doc[], productRows: { id: number; name: string; productionChecks?: string | null; productOwnerTestsStaging?: boolean | null }[], wip: Base['wip']): Promise<TicketRow[]> => {
  const ws = { workspace: { equals: workspace } }
  const wf = workflowFor(workspace)
  const buildStage = byKind(wf, 'build')?.name
  const blockerIds = [...new Set(ticketDocs.flatMap((t) => (t.blockedBy ?? []) as number[]))]
  const parentIds = [...new Set(ticketDocs.flatMap((t) => (t.parent ? [t.parent as number] : [])))]
  const tickets = (ids: number[]) => (ids.length ? docsOf(payload, 'tickets', { where: { and: [ws, { id: { in: ids } }] } }) : [])
  const ids = ticketDocs.map((t) => t.id as number)
  const containerIds = ticketDocs.filter((t) => is(wf, stageOf(wf, t), 'container')).map((t) => t.id as number)
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
    containerIds.length ? docsOf(payload, 'tickets', { where: { and: [ws, { parent: { in: containerIds } }] }, select: { parent: true, state: true } }) : [],
    Promise.all(ticketDocs.filter((t) => t.state !== 'closed' && t.expedite).map(async (t) => [t.id as number, await fastLaneHolder(payload, t)] as const)).then((rows) => new Map(rows)),
  ])
  const blockers = new Map(blockerDocs.map((b) => [b.id as number, { id: b.id as number, number: b.number as number, open: b.state !== 'closed' }]))
  const parents = new Map(parentDocs.map((p) => [p.id as number, { id: p.id as number, number: p.number as number, title: p.title as string }]))
  const byId = new Map(productRows.map((p) => [p.id, p]))
  const gatesFor = await productGates(payload, wf, workspace, productRows)
  return ticketDocs.map((t): TicketRow => {
    const isOpen = t.state !== 'closed'
    const run = latest.get(t.id) ?? null
    const blockedBy = isOpen ? ((t.blockedBy ?? []) as number[]).flatMap((b) => (blockers.get(b)?.open ? [blockers.get(b)!] : [])) : []
    const need = needsOf(wf, t, run, !hasProductionChecks(byId.get(t.product) ?? {}), gatesFor(t.product))
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
      queuedWhy: overlap ? `waits for #${overlap}, which changes the same files` : fastLanes.get(t.id) ? fastLaneText(fastLanes.get(t.id)!) : t.waitingFor === 'checks' ? null : hold,
      forge: forges.get(t.product) ?? null,
      track: { waitingFor: t.waitingFor, reviewState: t.reviewState, releaseState: t.releaseState, productionState: t.productionState, releaseChecksState: t.releaseChecksState, releaseError: t.releaseError },
      children: containerIds.includes(t.id) ? { total: kids.filter((k) => k.parent === t.id).length, done: kids.filter((k) => k.parent === t.id && k.state === 'closed').length } : null,
      enteredAt: entered.get(t.id) ?? t.updatedAt,
      parent: parents.get(t.parent) ?? null,
      gate: isOpen && t.gateNotifiedAt ? { people: String(t.gateAssignees ?? '').split(',').filter(Boolean), since: t.gateNotifiedAt } : null,
      gateUnreachable: isOpen && !t.gateNotifiedAt ? (t.gateUnreachable ?? null) : null,
      blockedBy,
    }
  })
}

const epicOf = (wf: Workflow, e: Doc, subs: Doc[], byRow: Map<number, TicketRow>): Epic => ({
  id: e.id, number: e.number, title: e.title, open: e.state !== 'closed', rank: e.rank ?? null, product: e.product ?? null,
  children: subs.filter((c) => c.parent === e.id).map((c) => { const r = byRow.get(c.id); return { id: c.id, number: c.number, title: c.title, stage: stageOf(wf, c), open: c.state !== 'closed', status: r ? statusLine(wf, r) : 'Done' } }),
})

/** Everything the Board, Runs and the top bar need, from the database only (no forge call). */
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
  const wip = Object.fromEntries(wipStages(wf).map((s) => [s, { count: counts[s], limit: wipLimit(wsDoc, s, wf) }]))
  const productRows = products.docs as unknown as { id: number; name: string; productionChecks?: string | null }[]
  const [rows, epicDocs] = await Promise.all([rowsOf(payload, workspace, ticketDocs, productRows, wip), docsOf(payload, 'tickets', { where: { and: [ws, epicWhere(wf, [...new Set(subs.map((c) => c.parent as number))])] } })])
  const byRow = new Map(rows.map((r) => [r.id, r]))
  return { tickets: rows, runs: runRows, runsTotal: recent.totalDocs, products: productRows, epics: epicDocs.map((e) => epicOf(wf, e, subs, byRow)), wip }
})

/** Same data as `loadOverviewRows`; the name the Board and Runs pages use. */
export const loadOverview = loadOverviewRows

/** The epic a Ticket is (its sub-tickets with their status), else null; reads only that Ticket's children. */
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
  const rows = await rowsOf(payload, workspace, subs, products as never, Object.fromEntries(wipStages(wf).map((s) => [s, { count: counts[s], limit: wipLimit(wsDoc, s, wf) }])))
  return epicOf(wf, ticket, subs, new Map(rows.map((r) => [r.id, r])))
}
