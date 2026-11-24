import Link from 'next/link'
import { cn } from '@/lib/utils'
import { HELD_SENTENCES } from '../../lib/status-words'
import type { InboxRow as Row } from '../../lib/inbox'
import { captionOf } from '../factory/TicketCard'
import { StatusChip } from '../StatusChip'
import { Time } from '../Time'
import { Badge } from '../ui/badge'
import { TicketRef } from '../TicketRef'

const ROW = cn(
  'flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 outline-none',
  'hover:bg-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
  'md:grid md:grid-cols-[56px_minmax(0,1.6fr)_110px_200px_minmax(0,1.4fr)_96px]',
)

export const rowKeyOf = (row: Row): string =>
  row.kind === 'held' ? `held-${row.item.itemId}` : String(row.card.recordId)

export async function InboxRow({ row }: { row: Row }) {
  const key = rowKeyOf(row)
  if (row.kind === 'held') {
    const { item } = row
    return (
      <a data-inbox-row={key} href={item.url} target="_blank" rel="noopener noreferrer" className={ROW}>
        <span className="mono">#{item.number}</span>
        <span className="font-medium">
          {item.title}
          <span className="sr-only"> (opens in new tab)</span>
        </span>
        <span className="small text-muted-foreground">{row.repo}</span>
        <span><Badge>Held</Badge></span>
        <span className="small text-muted-foreground">{HELD_SENTENCES[item.reason] ?? item.reason}</span>
        <span />
      </a>
    )
  }
  const { card } = row
  return (
    <div className="relative">
      <Link data-inbox-row={key} href={`/tickets/${card.recordId}`} className={ROW}>
        <span aria-hidden className="mono invisible">#{card.number}</span>
        <span className="font-medium">{card.title}</span>
        <span className="small text-muted-foreground">{card.product.name}</span>
        <span><StatusChip status={card.status} closedAs={card.closedAs} /></span>
        <span className="small text-muted-foreground">{captionOf(card)}</span>
        <Time iso={card.enteredAt} className="mono whitespace-nowrap text-muted-foreground md:text-right" />
      </Link>
      <span className="absolute top-2.5 left-4 z-10">
        <TicketRef recordId={card.recordId} number={card.number} />
      </span>
    </div>
  )
}
