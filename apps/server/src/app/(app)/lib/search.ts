'use server'
import type { Where } from 'payload'
import { currentWorkspace, payloadClient } from './session'

export type TicketHit = { id: number; number: number; title: string }

/** Command palette: up to 8 Tickets of the selected Workspace whose number is `#123`/`123` or whose title contains `q`. Database only. */
export async function searchTickets(q: string): Promise<TicketHit[]> {
  const { workspace } = await currentWorkspace()
  const term = q.trim().replace(/^#/, '')
  if (!workspace || !term) return []
  const payload = await payloadClient()
  const find = (match: Where, limit: number) => payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace.id } }, match] }, sort: '-number', limit, depth: 0, select: { number: true, title: true }, overrideAccess: true })
  const [exact, titled] = await Promise.all([/^\d{1,9}$/.test(term) ? find({ number: { equals: Number(term) } }, 1) : { docs: [] }, find({ title: { contains: term } }, 8)])
  const seen = new Set<number>()
  return [...exact.docs, ...titled.docs].filter((t) => !seen.has(t.id as number) && seen.add(t.id as number)).slice(0, 8).map((t) => ({ id: t.id as number, number: t.number as number, title: t.title as string }))
}
