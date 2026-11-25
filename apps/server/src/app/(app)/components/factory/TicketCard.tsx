import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { BoardCard } from '../../../../core/views/board'
import { workerOf } from '../../lib/factory'
import { adoptedLine } from '../../lib/ticket'
import { StatusChip } from '../StatusChip'
import { Time } from '../Time'
import { TicketRef } from '../TicketRef'
import { RelationBadges } from './RelationBadges'
import { RelationTag } from './RelationScope'

const CARD = 'relative grid min-w-0 justify-items-start gap-1.5 rounded-md border bg-card px-3 py-2.5'
const SELECTION = cn(
  'has-[[data-rel=dim]]:opacity-20 has-[[data-rel=related]]:outline-2 has-[[data-rel=related]]:outline-dashed',
  'has-[[data-rel=related]]:outline-primary has-[[data-rel=selected]]:outline-2',
  'has-[[data-rel=selected]]:outline-solid has-[[data-rel=selected]]:outline-primary',
)
const LINK = "font-medium leading-5 after:absolute after:inset-0 after:content-['']"

const frameOf = (card: BoardCard): string => {
  if (card.state === 'stuck') return 'border-destructive'
  if (card.state === 'owner') return 'border-warn'
  return card.state === 'agents' && card.run?.leasedBy != null ? 'border-dashed border-primary' : 'border-border'
}

const edgeOf = (card: BoardCard): string =>
  cn(
    (card.relations?.blocks.length ?? 0) > 0 && 'border-l-4 border-l-destructive',
    (card.relations?.blockedBy.length ?? 0) > 0 && 'bg-secondary',
  )

const sessionOf = (run: BoardCard['run']): string | null => {
  if (run === null) return null
  return run.leasedBy === null ? `Queued for ${run.role}` : workerOf(run.leasedBy).name
}

const criteriaOf = (card: BoardCard): string | null =>
  card.criteria && (card.stage === 'verify' || card.stage === 'ship')
    ? `Criteria met: ${card.criteria.met} of ${card.criteria.total}`
    : null

export const captionOf = (card: BoardCard): string | null => {
  const adopted = card.adopted ? adoptedLine(card.adopted) : null
  const parts = [adopted, card.parkedReason, card.detail, criteriaOf(card), sessionOf(card.run)].filter(
    (part) => part !== null,
  )
  return parts.length ? parts.join(' · ') : null
}

export async function TicketCard({ card }: { card: BoardCard }) {
  const caption = captionOf(card)
  const { relations } = card
  return (
    <div
      className={cn(CARD, frameOf(card), edgeOf(card), SELECTION)}
      data-blocked={(relations?.blockedBy.length ?? 0) > 0 || undefined}
    >
      <div className="flex w-full items-baseline justify-between gap-2">
        <TicketRef recordId={card.recordId} number={card.number} />
        <Time iso={card.enteredAt} className="mono text-muted-foreground" />
      </div>
      <Link href={`/tickets/${card.recordId}`} data-card-link draggable={false} className={LINK}>
        {card.title}
      </Link>
      <StatusChip status={card.status} closedAs={card.closedAs} />
      {relations && <RelationBadges recordId={card.recordId} relations={relations} />}
      <RelationTag recordId={card.recordId} number={card.number} related={relations !== null} />
      {caption && <span className="small text-muted-foreground">{caption}</span>}
    </div>
  )
}
