'use server'
import type { Where } from 'payload'
import { currentWorkspace, payloadClient } from './session'

export type TicketHit = { id: number; number: number; title: string }

/** Command palette: up to 8 Tickets of the selected Workspace whose number is `#123`/`123` or whose title contains `q`. Database only. */
export async function searchTickets(q: string): Promise<TicketHit[]> {
  const { workspace } = await currentWorkspace()
  const term = q.trim().replace(/^#/, '')
  if (!workspace || !term) return []
  const match: Where = /^\d{1,9}$/.test(term) ? { or: [{ number: { equals: Number(term) } }, { title: { contains: term } }] } : { title: { contains: term } }
  const { docs } = await (await payloadClient()).find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace.id } }, match] }, sort: '-number', limit: 8, depth: 0, select: { number: true, title: true }, overrideAccess: true })
  return docs.map((t) => ({ id: t.id as number, number: t.number as number, title: t.title as string }))
}
