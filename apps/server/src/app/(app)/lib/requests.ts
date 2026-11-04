import type { Where } from 'payload'
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
      resumable: s.status === 'open' && userId != null && idOf(s.user) === userId,
      updatedAt: s.updatedAt,
      ticket: s.ticketNumber == null ? null : { number: s.ticketNumber, id: t?.id },
    }
  })
  return { rows, total: sessions.totalDocs, multiProduct }
}

/** Number of the caller's open Drafts with messages in a Workspace (the Requests nav badge). */
export async function countOwnDrafts(userId: number, workspaceId: number) {
  return (await openSessions(userId, workspaceId)).open.length
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
