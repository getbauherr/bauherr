'use client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { InboxItem } from '../lib/inbox'
import { DecisionCard } from './DecisionCard'

/** The reading pane: the selected decision as the full card. Below 960px it is the whole page, with a link back to the list. */
export function InboxPane({ item, admin, multi, back, onDecided, onFailed }: { item: InboxItem; admin: boolean; multi: boolean; back: string; onDecided: (id: number) => void; onFailed: (id: number) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 break-words [overflow-wrap:anywhere]" data-testid="inbox-pane">
      <Link href={back} className="small inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground group-data-[wide=true]/split:hidden"><ArrowLeft className="size-4" aria-hidden />Inbox</Link>
      <DecisionCard key={item.id} item={{ ...item, product: multi ? item.product.name : undefined }} admin={admin} onDecided={onDecided} onFailed={onFailed} />
    </div>
  )
}
