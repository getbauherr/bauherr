import type { Where } from 'payload'
import { payloadClient } from './session'

type Ref = number | { id: number; name?: string }
type Session = { id: number; product: Ref; status: string; draft?: { problem?: string } | null; ticketNumber?: number | null; updatedAt: string }
type TicketDoc = { id: number; number: number; title: string; stage?: string | null; product: Ref; parent?: Ref | null }
const idOf = (r: Ref | null | undefined) => (typeof r === 'object' ? r?.id : r)

export const REQUESTS_LIMIT = 100
export type RequestRow = {
  id: number
  title: string
  product: string
  linked: boolean
  updatedAt: string
  ticket: { number: number; id?: number; title?: string; stage?: string | null; children: { id: number; number: number; title: string }[] } | null
}

const cut = (s: string) => {
  const line = s.trim().split('\n')[0]
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** Requests (Intake sessions, embed sessions included) of a Workspace, newest first. Conversation text only feeds the title fallback. */
export async function loadRequests(workspaceId: number): Promise<{ rows: RequestRow[]; total: number }> {
  const payload = await payloadClient()
  const o = { overrideAccess: true, pagination: false } as const
  const sessions = await payload.find({
    collection: 'intake_sessions',
    where: { 'product.workspace': { equals: workspaceId }, status: { in: ['open', 'submitted'] } },
    sort: '-updatedAt', limit: REQUESTS_LIMIT, pagination: true, depth: 1,
    select: { product: true, status: true, draft: true, ticketNumber: true, updatedAt: true },
    overrideAccess: true,
  })
  const docs = sessions.docs as unknown as Session[]
  const pairs = docs.filter((s) => s.ticketNumber != null).map((s) => ({ and: [{ product: { equals: idOf(s.product) } }, { number: { equals: s.ticketNumber } }] as Where[] }))
  const tickets = pairs.length
    ? (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspaceId }, or: pairs }, depth: 0, select: { title: true, number: true, product: true, stage: true }, ...o })).docs as unknown as TicketDoc[]
    : []
  const children = tickets.length
    ? (await payload.find({ collection: 'tickets', where: { parent: { in: tickets.map((t) => t.id) } }, sort: 'number', depth: 0, select: { title: true, number: true, parent: true }, ...o })).docs as unknown as TicketDoc[]
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
      updatedAt: s.updatedAt,
      ticket: s.ticketNumber == null ? null : {
        number: s.ticketNumber, id: t?.id, title: t?.title, stage: t?.stage,
        children: t ? children.filter((c) => idOf(c.parent) === t.id).map((c) => ({ id: c.id, number: c.number, title: c.title })) : [],
      },
    }
  })
  return { rows, total: sessions.totalDocs }
}
