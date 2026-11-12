import type { Where } from 'payload'
import { cardData } from '../../../lib/chat/request'
import { cardOf, type CardData } from '../../../lib/intake/card'
import type { Kind } from '../../../lib/intake/kinds'
import { workflowFor } from '../../../lib/factory'
import { EXPEDITE_PROPOSED, type Need } from '../../../lib/needs-you'
import { loadProgress, type Progress } from '../../../lib/progress'
import { canDecide } from '../../../lib/decision'
import { kindOf, type Kind as StageKind, type Workflow } from '../../../lib/workflow'
import { canSeeProduct, isBauherr, isProductOwner, productScope, productsVisibleTo, requestsVisibleTo } from '../../../lib/people'
import { kindOfLabels } from './overview'
import { payloadClient } from './session'

type Ref = number | { id: number; name?: string; email?: string }
type Session = { id: number; product: Ref; user?: Ref | null; status: string; draft?: { problem?: string; title?: string; type?: Kind; urgency?: string } | null; title?: string | null; kind?: Kind | null; urgency?: string | null; ticketNumber?: number | null; updatedAt: string }
type TicketDoc = Record<string, any> & { id: number; number: number; product: Ref }
type Viewer = { id?: number | string; role?: string | null; assignments?: unknown; tenants?: unknown }
const idOf = (r: Ref | null | undefined) => (typeof r === 'object' ? r?.id : r)

export const REQUESTS_LIMIT = 100

/** Who a request waits for, from the viewer's side: the requester's own steps, the Bauherr's, or nobody's (the factory works). */
export type Waits = 'You' | 'The requester' | 'The Bauherr' | 'The factory'
/** The needs the person who asked answers (questions about the request, the result on staging); every other need is the Bauherr's. */
const REQUESTER_NEEDS: readonly Need[] = ['Answer questions', 'Answer decisions', 'Accept on staging']
const STATUS_BY_KIND: Partial<Record<StageKind, string>> = { triage: 'Being looked at', plan: 'Being planned', container: 'Being planned', build: 'Being built', agent: 'Being built', review: 'Being reviewed', release: 'Going live', human: 'Waiting for the Bauherr' }

/** One plain-word status and who it waits for, from the stage KIND (never its name), the need and the Run's progress key. `mine`: the viewer asked for it. */
export const lifecycleOf = (wf: Workflow, t: Record<string, any>, key: Progress['key'] | null, mine: boolean): { status: string; waits: Waits; lane: 'proposed' | 'fast' | null } => {
  const kind = (t.stage && kindOf(wf, t.stage)) || 'triage'
  const need = t.needsYou ?? null
  const proposed = !t.expedite && !!t.labels?.includes(EXPEDITE_PROPOSED) && t.state !== 'closed'
  const requester: Waits = mine ? 'You' : 'The requester'
  if (proposed) return { status: 'Urgent · waiting for the Bauherr', waits: 'The Bauherr', lane: 'proposed' }
  const lane = t.expedite ? 'fast' : null
  if (need && REQUESTER_NEEDS.includes(need)) return { status: need === 'Accept on staging' ? 'Ready for you to test' : 'Waiting for your answer', waits: requester, lane }
  if (need || key === 'stuck') return { status: STATUS_BY_KIND[kind as StageKind] ?? 'Being looked at', waits: 'The Bauherr', lane }
  if (key === 'question') return { status: 'Waiting for your answer', waits: requester, lane }
  if (key === 'approval') return { status: 'Being planned', waits: 'The Bauherr', lane }
  return { status: STATUS_BY_KIND[kind as StageKind] ?? 'Being looked at', waits: 'The factory', lane }
}

export type RequestRow = {
  id: number
  title: string
  product: string
  productId: number
  kind: Kind | null
  urgent: boolean
  /** Who asked (name or email), for the By column. */
  by: string
  mine: boolean
  /** Same-origin target of the title link: the request page. */
  href: string
  updatedAt: string
  ticket: { number: number; id?: number } | null
  status: string
  waits: Waits | null
  /** `proposed`: asked for the fast lane, the Bauherr has not decided; `fast`: on it. */
  lane: 'proposed' | 'fast' | null
  /** What the viewer does about it now (the need), when it is theirs. */
  need: Need | null
  /** Released: the release note line; declined: why. */
  note: string | null
  progress: (Progress & { since: string | null }) | null
}

const cut = (s: string) => {
  const line = s.trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
const titleOf = (s: Pick<Session, 'title' | 'draft'>) => (s.title?.trim() || s.draft?.title?.trim() || (s.draft?.problem?.trim() && cut(s.draft.problem)) || 'Untitled request')

export type Filters = { product?: number; kind?: Kind; mine?: boolean }
export type Workbench = { needs: RequestRow[]; factory: RequestRow[]; done: RequestRow[]; products: { id: number; name: string }[]; multiProduct: boolean; showBy: boolean; total: number }

/** Whether `need` is the viewer's to act on: the requester's steps on their own request, or a Bauherr's step they may decide (an Expedite is an Admin's; a Product owner has no Bauherr step until the decisions slice). */
const needsViewer = (user: Viewer, need: Need | null, mine: boolean): boolean => !!need && (REQUESTER_NEEDS.includes(need) ? mine : !isProductOwner(user) && canDecide(user, need))

/** Sent requests of a Workspace for the Requests page, in three sections (Needs you, In the factory, Done), without conversation text. Database only. */
export async function loadWorkbench(workspaceId: number, user: Viewer, filters: Filters = {}): Promise<Workbench> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false } as const
  const sessions = await payload.find({
    collection: 'intake_sessions',
    where: { and: [requestsVisibleTo(user, workspaceId), { status: { equals: 'submitted' } }, { persona: { not_equals: 'owner' } }, ...(filters.product ? [{ product: { equals: filters.product } }] : []), ...(filters.kind ? [{ kind: { equals: filters.kind } }] : []), ...(filters.mine ? [{ user: { equals: user.id } }] : [])] },
    sort: '-updatedAt', limit: REQUESTS_LIMIT, pagination: true, depth: 1,
    select: { product: true, user: true, status: true, draft: true, title: true, kind: true, urgency: true, ticketNumber: true, updatedAt: true },
    overrideAccess: true,
  })
  const products = (await payload.find({ collection: 'products', where: productsVisibleTo(user, workspaceId), sort: 'name', select: { name: true }, depth: 0, ...o })).docs.map((p) => ({ id: p.id as number, name: p.name as string }))
  const docs = sessions.docs as unknown as Session[]
  const pairs = docs.filter((s) => s.ticketNumber != null).map((s) => ({ and: [{ product: { equals: idOf(s.product) } }, { number: { equals: s.ticketNumber } }] as Where[] }))
  const tickets = pairs.length ? ((await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, or: pairs }, depth: 0, ...o })).docs as unknown as TicketDoc[]) : []
  const progress = await loadProgress(payload, tickets)
  const closed = tickets.filter((t) => progress.get(t.id)?.key === 'closed').map((t) => t.id)
  const skips = closed.length ? ((await payload.find({ collection: 'runs', where: { ticket: { in: closed } }, sort: '-createdAt', select: { ticket: true, artifacts: true }, depth: 0, ...o })).docs as unknown as { ticket: Ref; artifacts?: { triage?: { outcome?: string; reason?: string } } | null }[]) : []
  const wf = workflowFor(workspaceId)
  const rows = docs.map((s): { row: RequestRow; rank: string | null } => {
    const productId = idOf(s.product) as number
    const t = s.ticketNumber == null ? undefined : tickets.find((x) => x.number === s.ticketNumber && idOf(x.product) === productId)
    const p = (t && progress.get(t.id)) || null
    const mine = user.id != null && String(idOf(s.user)) === String(user.id)
    const done = t?.state === 'closed'
    const stand = done ? { status: 'Done', waits: null, lane: null } : t ? lifecycleOf(wf, t, p?.key ?? null, mine) : { status: 'Being looked at', waits: 'The factory' as Waits, lane: null }
    const declined = done && p?.key === 'closed'
    const reason = declined ? skips.find((r) => idOf(r.ticket) === t!.id && r.artifacts?.triage?.outcome === 'skip')?.artifacts?.triage?.reason : undefined
    const need = (t && !done && (t.needsYou as Need | null)) || null
    return {
      rank: (t?.rank as string | null | undefined) ?? null,
      row: {
        id: s.id,
        title: titleOf(s),
        product: (typeof s.product === 'object' && s.product.name) || '—',
        productId,
        kind: s.kind ?? s.draft?.type ?? null,
        urgent: s.urgency === 'urgent' || s.draft?.urgency === 'urgent',
        by: (typeof s.user === 'object' && s.user && (s.user.name ?? s.user.email)) || 'Product widget',
        mine,
        href: `/requests/${s.id}`,
        updatedAt: s.updatedAt,
        ticket: s.ticketNumber == null ? null : { number: s.ticketNumber, id: t?.id },
        status: declined ? `Declined${reason ? `: ${reason}` : ''}` : stand.status,
        waits: stand.waits,
        lane: stand.lane,
        need,
        note: done && !declined ? (p?.detail?.split('\n')[0] ?? null) : null,
        progress: p,
      },
    }
  })
  const byRank = (a: { rank: string | null; row: RequestRow }, b: { rank: string | null; row: RequestRow }) => (a.rank === b.rank ? 0 : a.rank === null ? 1 : b.rank === null ? -1 : a.rank < b.rank ? -1 : 1) || b.row.updatedAt.localeCompare(a.row.updatedAt)
  const open = rows.filter((r) => r.row.waits !== null)
  const needs = open.filter((r) => needsViewer(user, r.row.need, r.row.mine))
  return {
    needs: needs.map((r) => r.row),
    factory: open.filter((r) => !needs.includes(r)).sort(byRank).map((r) => r.row),
    done: rows.filter((r) => r.row.waits === null).map((r) => r.row),
    products,
    multiProduct: products.length > 1,
    showBy: isBauherr(user),
    total: sessions.totalDocs,
  }
}

export type DraftRow = { id: number; title: string; product: string; productId: number; updatedAt: string; kind: Kind | null; urgent: boolean; /** Plain words of what is missing to send; empty when it can be sent. */ missing: string[]; canSend: boolean }

/** Every open draft of the person in a Workspace that has been written to (newest first, no cut-off): the title is the card's title, the draft's problem or the first message. */
export async function loadDrafts(user: Viewer & { id: number | string }, workspaceId: number): Promise<DraftRow[]> {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'intake_sessions',
    where: { and: [productScope(user, workspaceId), { user: { equals: user.id } }, { persona: { equals: 'product-user' } }, { status: { equals: 'open' } }, { workspace: { equals: workspaceId } }, { draft: { exists: true } }] },
    sort: '-updatedAt', pagination: false, depth: 1, select: { product: true, draft: true, title: true, kind: true, urgency: true, messages: true, screenshots: true, turn: true, split: true, updatedAt: true }, overrideAccess: true,
  })
  return docs.map((s) => {
    const first = ((s.messages as { role: string; content: string }[] | null) ?? []).find((m) => m.role === 'user')?.content ?? ''
    const card = cardOf(s, { editable: false, images: [], fastLane: true, maxImages: 0 })
    return { id: s.id as number, title: titleOf(s as never) !== 'Untitled request' ? titleOf(s as never) : cut(first) || 'Untitled request', product: String((s.product && typeof s.product === 'object' && (s.product as { name?: string }).name) || '—'), productId: idOf(s.product as Ref) as number, updatedAt: s.updatedAt as string, kind: card.kind, urgent: card.urgency === 'urgent', missing: card.missing, canSend: card.canSend }
  })
}

/** Whether the session is one of the person's open drafts in the Workspace (the `?session=` link of `/requests/new`). */
export async function ownsDraft(userId: number, workspaceId: number, id: number): Promise<boolean> {
  const payload = await payloadClient()
  return (await payload.count({ collection: 'intake_sessions', where: { and: [{ id: { equals: id } }, { user: { equals: userId } }, { persona: { equals: 'product-user' } }, { status: { equals: 'open' } }, { workspace: { equals: workspaceId } }] }, overrideAccess: true })).totalDocs > 0
}

/** Number of the caller's open Drafts with messages in a Workspace (the Requests nav badge). */
export async function countOwnDrafts(userId: number, workspaceId: number) {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'intake_sessions',
    where: { and: [{ user: { equals: userId } }, { persona: { equals: 'product-user' } }, { status: { equals: 'open' } }, { workspace: { equals: workspaceId } }] },
    select: { messages: true }, depth: 0, pagination: false, overrideAccess: true,
  })
  return docs.filter((s) => (s.messages as unknown[] | null)?.length).length
}

export type RequestTicket = { id: number; number: number; title: string; status: string; waits: Waits | null; lane: 'proposed' | 'fast' | null; kind: Kind | null; need: Need | null; url: string | null; progress: Progress & { since: string | null } }
export type TimelineEntry = { at: string; text: string }
type EventRow = { at: string; stageKind?: string | null; phase?: string | null; cause?: string | null }

/** The plain-word history of a request from its Ticket's events, oldest first, each step once (a build and review loop says "Built" once): no Runs, no stage names, no agents. `sentAt` opens it. */
export const timelineOf = (sentAt: string, events: EventRow[], closedWithChange: boolean): TimelineEntry[] => {
  const out: TimelineEntry[] = [{ at: sentAt, text: 'Sent' }]
  const add = (at: string, text: string) => out.some((e) => e.text === text) || out.push({ at, text })
  let previous: string | null = null
  for (const e of events) {
    const cause = e.cause ?? ''
    if (/^moveStage:expedite|^expedite/.test(cause)) add(e.at, 'Put on the fast lane')
    if (e.stageKind === 'triage' && e.phase === 'human') add(e.at, 'Question for you')
    if (/^gate:decide/.test(cause)) add(e.at, 'Question answered')
    if (cause === 'gate:approve:plan') add(e.at, 'Plan approved')
    if (e.stageKind !== previous) {
      if (e.stageKind === 'review') add(e.at, 'Built')
      if (e.stageKind === 'plan' && !out.some((x) => x.text === 'Plan approved')) add(e.at, 'Being planned')
    }
    if (cause === 'release:on_staging') add(e.at, 'Ready for you to test')
    if (cause === 'gate:accept:staging' || cause === 'staging:accepted') add(e.at, 'Accepted')
    if (cause === 'gate:approve:production') add(e.at, 'Approved to go live')
    if (e.phase === 'closed' || e.stageKind === 'done') add(e.at, closedWithChange ? 'Live' : 'Closed')
    previous = e.stageKind ?? previous
  }
  return out
}

/** The card as a Product owner reads it: never editable here (no dock), and its images through the signed-in route instead of the public link. */
const cardFor = (user: Viewer, card: CardData): CardData => (isProductOwner(user) ? { ...card, editable: false, productChoices: [], images: card.images.map((i) => ({ ...i, url: `/intake/api/media/${i.id}` })) } : card)

export type RequestPage = {
  id: number
  title: string
  product: string
  sent: boolean
  /** The caller can continue this Draft in the chat. */
  own: boolean
  /** The caller started this request. */
  mine: boolean
  card: CardData
  tickets: RequestTicket[]
  timeline: TimelineEntry[]
  /** The first Ticket is closed and shipped: "Report a problem" is offered. */
  released: boolean
}

/** One Request for its page, or null when it does not exist, is an owner session, belongs to another Workspace or is not visible to the viewer. Linked Tickets are `ticketNumbers` (fallback `ticketNumber`) of the same Product. */
export async function loadRequest(workspaceId: number, id: number, user: Viewer & { id: number | string }): Promise<RequestPage | null> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false, depth: 0 } as const
  const [s] = (await payload.find({ collection: 'intake_sessions', where: { and: [{ id: { equals: id } }, requestsVisibleTo(user, workspaceId), { persona: { not_equals: 'owner' } }, { status: { in: ['open', 'submitted'] } }] }, limit: 1, depth: 1, overrideAccess: true })).docs as unknown as (Session & { ticketNumbers?: number[] | null })[]
  if (!s) return null
  const wf = workflowFor(workspaceId)
  const mine = String(idOf(s.user)) === String(user.id)
  const numbers = s.ticketNumbers?.length ? s.ticketNumbers : s.ticketNumber != null ? [s.ticketNumber] : []
  const docs = numbers.length ? (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, product: { equals: idOf(s.product) }, number: { in: numbers } }, sort: 'number', ...o })).docs as unknown as TicketDoc[] : []
  const progress = await loadProgress(payload, docs)
  const first = docs[0]
  const events = first ? ((await payload.find({ collection: 'ticket_events', where: { ticket: { equals: first.id } }, sort: 'at', select: { at: true, stageKind: true, phase: true, cause: true }, ...o })).docs as unknown as EventRow[]) : []
  const shipped = !!first && first.state === 'closed' && progress.get(first.id)?.key === 'released'
  return {
    id: s.id,
    title: titleOf(s),
    product: (typeof s.product === 'object' && s.product.name) || '—',
    sent: s.status === 'submitted',
    own: s.status === 'open' && mine,
    mine,
    card: cardFor(user, await cardData({ payload, user: user as never, workspace: workspaceId }, s as never, mine)),
    tickets: docs.map((t) => {
      const stand = t.state === 'closed' ? { status: 'Done', waits: null, lane: null } : lifecycleOf(wf, t, progress.get(t.id)?.key ?? null, mine)
      return { id: t.id, number: t.number, title: t.title, url: t.url ?? null, ...stand, kind: kindOfLabels(t.labels), progress: progress.get(t.id)!, need: t.state === 'closed' ? null : (t.needsYou as Need | null) ?? null }
    }),
    timeline: s.status === 'submitted' ? timelineOf(first?.createdAt ?? s.updatedAt, events, shipped) : [],
    released: shipped,
  }
}

export type OwnerTicket = { ticket: RequestTicket; product: { id: number; name: string }; /** The request that created it, when it has one. */ request: number | null; card: CardData | null; timeline: TimelineEntry[]; released: boolean; note: string | null }

/** The Ticket as a Product owner sees it, or null when it does not exist, is in another Workspace or its Product is not assigned to them (one answer for all three: a 404). Database only: no Runs, steps, cost or plan are read. */
export async function loadOwnerTicket(workspaceId: number, id: number, user: Viewer & { id: number | string }): Promise<OwnerTicket | null> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false, depth: 0 } as const
  const [t] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspaceId } }] }, limit: 1, ...o })).docs as unknown as TicketDoc[]
  if (!t || !canSeeProduct(user, { id: idOf(t.product)!, workspace: workspaceId })) return null
  const product = (await payload.findByID({ collection: 'products', id: idOf(t.product)!, select: { name: true }, ...o })) as { id: number; name: string }
  const [s] = (await payload.find({ collection: 'intake_sessions', where: { and: [{ product: { equals: product.id } }, { ticketNumber: { equals: t.number } }, { status: { equals: 'submitted' } }, { persona: { not_equals: 'owner' } }] }, limit: 1, ...o, depth: 1 })).docs as unknown as Session[]
  const p = (await loadProgress(payload, [t])).get(t.id)!
  const events = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: t.id } }, sort: 'at', select: { at: true, stageKind: true, phase: true, cause: true }, ...o })).docs as unknown as EventRow[]
  const closed = t.state === 'closed'
  const released = closed && p.key === 'released'
  const stand = closed ? { status: 'Done', waits: null, lane: null } : lifecycleOf(workflowFor(workspaceId), t, p.key, !!s && String(idOf(s.user)) === String(user.id))
  return {
    ticket: { id: t.id, number: t.number, title: t.title, url: null, ...stand, kind: kindOfLabels(t.labels), progress: p, need: closed ? null : (t.needsYou as Need | null) ?? null },
    product,
    request: s?.id ?? null,
    card: s ? cardFor(user, await cardData({ payload, user: user as never, workspace: workspaceId }, s as never, false)) : null,
    timeline: timelineOf(String(t.createdAt ?? s?.updatedAt), events, released),
    released,
    note: released ? (p.detail?.split('\n')[0] ?? null) : null,
  }
}
