import type { Ticket } from '@bauherr/adapters'
import type { Payload } from 'payload'
import type { Edge } from './rules'
import { deleteEdge, edgesOfItem, insertEdge, itemsByNumber } from './store'
import { RELATION_TYPES, type RelationType } from './types'

type Where = { workspace: number; repo: string }

export const forgeNumbers = (ticket: Ticket, type: RelationType): number[] => {
  const field = type.forge?.field
  const parents = ticket.parent ? [ticket.parent] : []
  const ids = field === 'parent' ? parents : field === 'blockedBy' ? ticket.blockedBy : []
  return ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
}

const same = (a: Edge, b: Edge): boolean => a.from === b.from && a.to === b.to && a.type === b.type

export const syncRelations = async (
  payload: Payload,
  where: Where,
  item: number,
  ticket: Ticket,
  types: readonly RelationType[] = RELATION_TYPES,
): Promise<void> => {
  const stored = await edgesOfItem(payload, item)
  for (const type of types) {
    if (!type.forge) continue
    const mine = type.forge.ticketIs
    const others = await itemsByNumber(payload, where.workspace, where.repo, forgeNumbers(ticket, type))
    const toEdge = (other: number): Edge =>
      mine === 'to' ? { from: other, to: item, type: type.key } : { from: item, to: other, type: type.key }
    const wanted = [...others.values()].map(toEdge)
    const current = stored.filter((edge) => edge.type === type.key && edge[mine] === item)
    for (const edge of current.filter((c) => !wanted.some((w) => same(c, w)))) await deleteEdge(payload, edge)
    for (const edge of wanted.filter((w) => !current.some((c) => same(c, w)))) {
      await insertEdge(payload, where.workspace, edge)
    }
  }
}
