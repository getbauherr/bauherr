import Link from 'next/link'
import { cn } from '@/lib/utils'
import { TABS, TAB_LABELS, ticketHref, type Tab } from '../../lib/ticket'

export function TicketTabs({ recordId, current }: { recordId: number; current: Tab }) {
  return (
    <nav aria-label="Ticket tabs" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab}
          href={ticketHref(recordId, tab)}
          aria-current={tab === current ? 'page' : undefined}
          className={cn(
            'rounded-t-md px-3 py-2 text-muted-foreground outline-none hover:text-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring',
            tab === current && 'bg-accent font-medium text-foreground',
          )}
        >
          {TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  )
}
