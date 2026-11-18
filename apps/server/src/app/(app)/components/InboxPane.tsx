'use client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { DecisionOption } from '../../../lib/decision'
import type { InboxItem } from '../lib/inbox'
import { DecisionCard } from './DecisionCard'

export function InboxPane({ item, admin, multi, back, onDecided, onSucceeded, onFailed }: { item: InboxItem; admin: boolean; multi: boolean; back: string; onDecided: (id: number, option: DecisionOption) => void; onSucceeded: (id: number, option: DecisionOption) => void; onFailed: (id: number, error: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 break-words [overflow-wrap:anywhere]" data-testid="inbox-pane">
      <Link href={back} data-testid="inbox-back" className="small inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground group-data-[wide=true]/split:hidden"><ArrowLeft className="size-4" aria-hidden />Inbox</Link>
      <DecisionCard key={item.id} item={{ ...item, product: multi ? item.product.name : undefined }} admin={admin} onDecided={onDecided} onSucceeded={onSucceeded} onFailed={onFailed} />
    </div>
  )
}
