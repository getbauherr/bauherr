import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { BoardCard } from '../../../../core/views/board'
import { StatusChip } from '../StatusChip'
import { Time } from '../Time'

const CARD = 'relative grid min-w-0 justify-items-start gap-1.5 rounded-md border bg-card px-3 py-2.5'
const LINK = "font-medium leading-5 after:absolute after:inset-0 after:content-['']"

const frameOf = (card: BoardCard): string => {
  if (card.state === 'stuck') return 'border-destructive'
  if (card.state === 'owner') return 'border-warn'
  return card.state === 'agents' ? 'border-dashed border-primary' : 'border-border'
}

const sessionOf = (run: BoardCard['run']): string | null => {
  if (run === null) return null
  return run.leasedBy === null ? `Queued for ${run.role}` : `Session ${run.leasedBy.slice(0, 8)}`
}

export const captionOf = (card: BoardCard): string | null => {
  const parts = [card.parkedReason, card.detail, sessionOf(card.run)].filter((part) => part !== null)
  return parts.length ? parts.join(' · ') : null
}

export function TicketCard({ card }: { card: BoardCard }) {
  const caption = captionOf(card)
  return (
    <div className={cn(CARD, frameOf(card))}>
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="mono" title={card.product.name}>#{card.number}</span>
        <Time iso={card.enteredAt} className="mono text-muted-foreground" />
      </div>
      <Link href={`/tickets/${card.recordId}`} draggable={false} className={LINK}>
        {card.title}
      </Link>
      <StatusChip status={card.status} />
      {caption && <span className="small text-muted-foreground">{caption}</span>}
    </div>
  )
}
