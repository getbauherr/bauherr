import { cn } from '@/lib/utils'
import { STAGE_NAMES } from '../lib/factory'
import { ticketRefs } from '../lib/refs'
import { TicketRefPopover } from './TicketRefPopover'

type Props = { recordId: number; number: number; className?: string }

export async function TicketRef({ recordId, number, className }: Props) {
  const ticket = (await ticketRefs()).byId.get(recordId)
  if (!ticket) return <span className="mono">#{number}</span>
  return (
    <TicketRefPopover
      ticket={{ ...ticket, stage: STAGE_NAMES[ticket.stage] }}
      label={`#${number}`}
      className={cn('mono', className)}
    />
  )
}
