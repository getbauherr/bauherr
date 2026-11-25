import type { TicketSource } from '@bauherr/adapters'
import type { ForgeField } from './types'

type Tickets = Pick<TicketSource, 'addBlockedBy' | 'addSubTicket' | 'removeBlockedBy' | 'removeSubTicket'>

export const forgeAdd = (tickets: Tickets, field: ForgeField, ticket: string, other: string): Promise<void> =>
  field === 'parent' ? tickets.addSubTicket(other, ticket) : tickets.addBlockedBy(ticket, other)

export const forgeRemove = (tickets: Tickets, field: ForgeField, ticket: string, other: string): Promise<void> =>
  field === 'parent' ? tickets.removeSubTicket(other, ticket) : tickets.removeBlockedBy(ticket, other)
