import type { Where } from 'payload'
import { needsYou, type Need } from './needs-you'
import { payloadClient } from './session'

type Ref = number | { id: number; name?: string }
type Session = { id: number; product: Ref; user?: Ref | null; status: string; draft?: { problem?: string } | null; ticketNumber?: number | null; updatedAt: string }
type TicketDoc = { id: number; number: number; product: Ref }
const idOf = (r: Ref | null | undefined) => (typeof r === 'object' ? r?.id : r)

export const REQUESTS_LIMIT = 100
export type RequestRow = {
  id: number
  title: string
  product: string
  linked: boolean
  /** Same-origin target of the title link: the request page once sent, the chat for an own Draft. */
  href: string | null
  resumable: boolean
  updatedAt: string
  ticket: { number: number; id?: number } | null
}

const cut = (s: string) => {
  const line = s.trim().split('\n')[0]
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** Requests (Intake sessions, embed sessions included) of a Workspace, newest first. Own Drafts are resumable. Conversation text only feeds the title fallback. */
export async function loadRequests(workspaceId: number, userId?: number): Promise<{ rows: RequestRow[]; total: number; multiProduct: boolean }> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false } as const
  const sessions = await payload.find({
    collection: 'intake_sessions',
    where: { 'product.workspace': { equals: workspaceId }, status: { in: ['open', 'submitted'] }, persona: { not_equals: 'owner' } },
    sort: '-updatedAt', limit: REQUESTS_LIMIT, pagination: true, depth: 1,
    select: { product: true, user: true, status: true, draft: true, ticketNumber: true, updatedAt: true },
    overrideAccess: true,
  })
  const multiProduct = (await payload.count({ collection: 'products', where: { workspace: { equals: workspaceId } }, overrideAccess: true })).totalDocs > 1
  const docs = sessions.docs as unknown as Session[]
  const pairs = docs.filter((s) => s.ticketNumber != null).map((s) => ({ and: [{ product: { equals: idOf(s.product) } }, { number: { equals: s.ticketNumber } }] as Where[] }))
  const tickets = pairs.length
    ? (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, or: pairs }, depth: 0, select: { number: true, product: true }, ...o })).docs as unknown as TicketDoc[]
    : []
  const rows = docs.map((s): RequestRow => {
    const productId = idOf(s.product)
    const problem = s.draft?.problem
    const t = s.ticketNumber == null ? undefined : tickets.find((x) => x.number === s.ticketNumber && idOf(x.product) === productId)
    return {
      id: s.id,
      title: (problem?.trim() && cut(problem)) || 'Untitled request',
      product: (typeof s.product === 'object' && s.product.name) || '—',
      linked: s.status === 'submitted',
      href: s.status === 'submitted' ? `/requests/${s.id}` : s.status === 'open' && userId != null && idOf(s.user) === userId ? `/requests/new?session=${s.id}` : null,
      resumable: s.status === 'open' && userId != null && idOf(s.user) === userId,
      updatedAt: s.updatedAt,
      ticket: s.ticketNumber == null ? null : { number: s.ticketNumber, id: t?.id },
    }
  })
  return { rows, total: sessions.totalDocs, multiProduct }
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

/** The caller's resumable Intake sessions (newest open Drafts with messages) plus the `?session=` one when it is theirs: open, product-user, same Workspace. */
export async function openSessions(userId: number, workspaceId: number | undefined, wanted?: string) {
  if (workspaceId == null) return { open: [], current: undefined }
  const payload = await payloadClient()
  const mine = (extra: Where[] = []) => payload.find({ collection: 'intake_sessions', where: { and: [{ user: { equals: userId } }, { persona: { equals: 'product-user' } }, { status: { equals: 'open' } }, { workspace: { equals: workspaceId } }, ...extra] }, sort: '-updatedAt', limit: 10, depth: 1, overrideAccess: true }).then((r) => r.docs)
  const open = (await mine()).filter((s) => (s.messages as unknown[] | null)?.length)
  if (wanted && /^\d{1,9}$/.test(wanted) && !open.some((s) => String(s.id) === wanted)) open.push(...(await mine([{ id: { equals: Number(wanted) } }])))
  return { open, current: open.find((s) => String(s.id) === wanted) ?? open[0] }
}

/** Plain-language stage of a Ticket; the Board's stage names stay out of the Request page. */
const LIFECYCLE: Record<string, string> = { triage: 'Being looked at', plan: 'Being planned', build: 'Being built', review: 'Being reviewed', release: 'On staging', parent: 'Split into smaller tickets', done: 'Done' }
export const lifecycleOf = (t: { state?: string | null; stage?: string | null }) => (t.state === 'closed' ? 'Done' : LIFECYCLE[t.stage ?? 'triage'] ?? LIFECYCLE.triage!)

export type RequestTicket = { id: number; number: number; title: string; status: string; need: Need | null }
export type RequestPage = {
  id: number
  product: string
  sent: boolean
  /** The caller can continue this Draft in the chat. */
  own: boolean
  problem: string
  context: string
  criteria: string[]
  tickets: RequestTicket[]
}

/** One Request for its page, or null when it does not exist, is an owner session or belongs to another Workspace. Linked Tickets are `ticketNumbers` (fallback `ticketNumber`) of the same Product. */
export async function loadRequest(workspaceId: number, id: number, userId?: number): Promise<RequestPage | null> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false, depth: 0 } as const
  const [s] = (await payload.find({ collection: 'intake_sessions', where: { and: [{ id: { equals: id } }, { 'product.workspace': { equals: workspaceId } }, { persona: { not_equals: 'owner' } }, { status: { in: ['open', 'submitted'] } }] }, limit: 1, depth: 1, overrideAccess: true })).docs as unknown as (Session & { draft?: { problem?: string; context?: string; acceptance_criteria?: string[] }; ticketNumbers?: number[] | null })[]
  if (!s) return null
  const numbers = s.ticketNumbers?.length ? s.ticketNumbers : s.ticketNumber != null ? [s.ticketNumber] : []
  const docs = numbers.length ? (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, product: { equals: idOf(s.product) }, number: { in: numbers } }, sort: 'number', ...o })).docs as unknown as { id: number; number: number; title: string; state: string; stage: string | null; labels: string[]; releaseState?: string | null; productionState?: string | null; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null }[] : []
  const runs = docs.length ? (await payload.find({ collection: 'runs', where: { ticket: { in: docs.map((t) => t.id) } }, sort: '-createdAt', select: { ticket: true, stage: true, status: true, reasonKind: true }, ...o })).docs as unknown as { ticket: number; stage: string; status: string; reasonKind?: string | null }[] : []
  return {
    id: s.id,
    product: (typeof s.product === 'object' && s.product.name) || '—',
    sent: s.status === 'submitted',
    own: s.status === 'open' && userId != null && idOf(s.user) === userId,
    problem: s.draft?.problem?.trim() ?? '',
    context: s.draft?.context?.trim() ?? '',
    criteria: (s.draft?.acceptance_criteria ?? []).filter((c) => c.trim()),
    tickets: docs.map((t) => ({
      id: t.id, number: t.number, title: t.title, status: lifecycleOf(t),
      need: t.state === 'closed' ? null : needsYou({ stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState, productionState: t.productionState, releaseChecksState: t.releaseChecksState, reviewState: t.reviewState, reviewRounds: t.reviewRounds, expedite: t.expedite }, runs.find((r) => r.ticket === t.id) ?? null),
    })),
  }
}
