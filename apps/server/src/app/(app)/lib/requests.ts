import type { Where } from 'payload'
import { kindOf, type Workflow } from '../../../lib/workflow'
import { workflowFor } from '../../../lib/factory'
import { loadProgress, type Progress } from '../../../lib/progress'
import type { Need } from './needs-you'
import { payloadClient } from './session'

type Ref = number | { id: number; name?: string }
type Session = { id: number; product: Ref; user?: Ref | null; status: string; draft?: { problem?: string } | null; ticketNumber?: number | null; updatedAt: string }
type TicketDoc = Record<string, any> & { id: number; number: number; product: Ref }
const idOf = (r: Ref | null | undefined) => (typeof r === 'object' ? r?.id : r)

export const REQUESTS_LIMIT = 100
export type RequestRow = {
  id: number
  title: string
  product: string
  linked: boolean
  /** Same-origin target of the title link: the request page once sent. */
  href: string | null
  updatedAt: string
  ticket: { number: number; id?: number } | null
  /** Where the request's first Ticket stands, in plain words; null while it is a Draft. */
  progress: (Progress & { since: string | null }) | null
}

const cut = (s: string) => {
  const line = s.trim().split('\n')[0]
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** Requests (Intake sessions, embed sessions included) of a Workspace, newest first, without the caller's own Drafts (`loadDrafts` lists those). Conversation text only feeds the title fallback. */
export async function loadRequests(workspaceId: number, userId?: number): Promise<{ rows: RequestRow[]; total: number; multiProduct: boolean }> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false } as const
  const sessions = await payload.find({
    collection: 'intake_sessions',
    where: { 'product.workspace': { equals: workspaceId }, status: { in: ['open', 'submitted'] }, persona: { not_equals: 'owner' }, or: [{ status: { equals: 'submitted' } }, { draft: { exists: true } }] },
    sort: '-updatedAt', limit: REQUESTS_LIMIT, pagination: true, depth: 1,
    select: { product: true, user: true, status: true, draft: true, ticketNumber: true, updatedAt: true },
    overrideAccess: true,
  })
  const multiProduct = (await payload.count({ collection: 'products', where: { workspace: { equals: workspaceId } }, overrideAccess: true })).totalDocs > 1
  const docs = sessions.docs as unknown as Session[]
  const pairs = docs.filter((s) => s.ticketNumber != null).map((s) => ({ and: [{ product: { equals: idOf(s.product) } }, { number: { equals: s.ticketNumber } }] as Where[] }))
  const tickets = pairs.length
    ? (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, or: pairs }, depth: 0, ...o })).docs as unknown as TicketDoc[]
    : []
  const progress = await loadProgress(payload, tickets)
  const rows = docs.filter((s) => !(s.status === 'open' && userId != null && idOf(s.user) === userId)).map((s): RequestRow => {
    const productId = idOf(s.product)
    const problem = s.draft?.problem
    const t = s.ticketNumber == null ? undefined : tickets.find((x) => x.number === s.ticketNumber && idOf(x.product) === productId)
    return {
      id: s.id,
      title: (problem?.trim() && cut(problem)) || 'Untitled request',
      product: (typeof s.product === 'object' && s.product.name) || '—',
      linked: s.status === 'submitted',
      href: s.status === 'submitted' ? `/requests/${s.id}` : null,
      updatedAt: s.updatedAt,
      ticket: s.ticketNumber == null ? null : { number: s.ticketNumber, id: t?.id },
      progress: (t && progress.get(t.id)) || null,
    }
  })
  return { rows, total: sessions.totalDocs, multiProduct }
}

export type DraftRow = { id: number; title: string; product: string; updatedAt: string }

/** Every open draft of the person in a Workspace that has been written to (newest first, no cut-off): the title is the draft's problem or the first message. */
export async function loadDrafts(userId: number, workspaceId: number): Promise<DraftRow[]> {
  const payload = await payloadClient()
  const { docs } = await payload.find({
    collection: 'intake_sessions',
    where: { and: [{ user: { equals: userId } }, { persona: { equals: 'product-user' } }, { status: { equals: 'open' } }, { workspace: { equals: workspaceId } }, { draft: { exists: true } }] },
    sort: '-updatedAt', pagination: false, depth: 1, select: { product: true, draft: true, messages: true, updatedAt: true }, overrideAccess: true,
  })
  return docs.map((s) => {
    const first = ((s.messages as { role: string; content: string }[] | null) ?? []).find((m) => m.role === 'user')?.content ?? ''
    return { id: s.id as number, title: cut((s.draft as { problem?: string } | null)?.problem?.trim() || first) || 'Untitled request', product: String((s.product && typeof s.product === 'object' && (s.product as { name?: string }).name) || '—'), updatedAt: s.updatedAt as string }
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

/** Plain-language stage of a Ticket; the Board's stage names stay out of the Request page. */
const LIFECYCLE: Record<string, string> = { triage: 'Being looked at', plan: 'Being planned', build: 'Being built', review: 'Being reviewed', release: 'On staging', container: 'Split into smaller tickets', done: 'Done' }
export const lifecycleOf = (wf: Workflow, t: { state?: string | null; stage?: string | null }) => (t.state === 'closed' ? 'Done' : LIFECYCLE[(t.stage && kindOf(wf, t.stage)) || 'triage'] ?? LIFECYCLE.triage!)

export type RequestTicket = { id: number; number: number; title: string; status: string; need: Need | null; url: string | null; progress: Progress & { since: string | null } }
export type RequestPage = {
  id: number
  product: string
  sent: boolean
  /** The caller can continue this Draft in the chat. */
  own: boolean
  /** The caller started this request. */
  mine: boolean
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
  const wf = workflowFor(workspaceId)
  const numbers = s.ticketNumbers?.length ? s.ticketNumbers : s.ticketNumber != null ? [s.ticketNumber] : []
  const docs = numbers.length ? (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, product: { equals: idOf(s.product) }, number: { in: numbers } }, sort: 'number', ...o })).docs as unknown as { id: number; number: number; title: string; url?: string | null; needsYou?: Need | null; state: string; stage: string | null; labels: string[]; releaseState?: string | null; productionState?: string | null; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null }[] : []
  const progress = await loadProgress(payload, docs)
  return {
    id: s.id,
    product: (typeof s.product === 'object' && s.product.name) || '—',
    sent: s.status === 'submitted',
    own: s.status === 'open' && userId != null && idOf(s.user) === userId,
    mine: userId != null && idOf(s.user) === userId,
    problem: s.draft?.problem?.trim() ?? '',
    context: s.draft?.context?.trim() ?? '',
    criteria: (s.draft?.acceptance_criteria ?? []).filter((c) => c.trim()),
    tickets: docs.map((t) => ({
      id: t.id, number: t.number, title: t.title, url: t.url ?? null, status: lifecycleOf(wf, t), progress: progress.get(t.id)!,
      need: t.state === 'closed' ? null : t.needsYou ?? null,
    })),
  }
}
