import type { RelatedTicket } from '../../../../core/views/ticket-relations'
import { Badge } from '../ui/badge'

export function BlockedChip({ blockers }: { blockers: RelatedTicket[] }) {
  const open = blockers.filter((ticket) => ticket.open)
  if (open.length === 0) return null
  return <Badge variant="warn">Blocked by {open.map((ticket) => `#${ticket.number}`).join(', ')}</Badge>
}
