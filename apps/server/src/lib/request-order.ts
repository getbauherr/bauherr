import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

type Doc = Record<string, any>
const idOf = (v: unknown): number => Number(v && typeof v === 'object' ? (v as Doc).id : v)

/**
 * The person's priority among their own open requests of one Product: `ticketIds` is the order they want. Their Tickets keep the set of rank values they already hold and only trade places,
 * so no other Ticket moves and a Bauherr's order of everything else stays as it is; a Bauherr who drags a Ticket on the Workflow list afterwards simply writes a newer rank, so the Bauherr's last word wins.
 * Throws when a Ticket is not an open one of the person's own sent requests in this Workspace, the Tickets are of different Products, or one has no rank yet.
 */
export const orderOwnRequests = async (payload: Payload, user: { id: number | string }, workspace: number, ticketIds: number[]): Promise<void> => {
  if (new Set(ticketIds).size !== ticketIds.length || ticketIds.length < 2) return
  const o = { overrideAccess: true, depth: 0, pagination: false } as const
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ id: { in: ticketIds } }, { workspace: { equals: workspace } }, { state: { equals: 'open' } }] }, select: { number: true, product: true, rank: true }, ...o })).docs as Doc[]
  if (tickets.length !== ticketIds.length || new Set(tickets.map((t) => idOf(t.product))).size !== 1 || tickets.some((t) => !t.rank)) throw new Error('These requests cannot be ordered together.')
  const mine = (await payload.find({ collection: 'intake_sessions', where: { and: [{ user: { equals: user.id } }, { status: { equals: 'submitted' } }, { workspace: { equals: workspace } }, { product: { equals: idOf(tickets[0]!.product) } }, { ticketNumber: { in: tickets.map((t) => t.number) } }] }, select: { ticketNumber: true }, ...o })).docs as Doc[]
  const own = new Set(mine.map((s) => s.ticketNumber))
  if (tickets.some((t) => !own.has(t.number))) throw new Error('You can only order your own requests.')
  const slots = tickets.map((t) => t.rank as string).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const values = sql.join(ticketIds.map((id, i) => sql`(${id}::int, ${slots[i]}::text)`), sql`, `)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" AS t SET "rank" = v.rank FROM (VALUES ${values}) AS v(id, rank) WHERE t."id" = v.id AND t."workspace_id" = ${workspace}`)
}
