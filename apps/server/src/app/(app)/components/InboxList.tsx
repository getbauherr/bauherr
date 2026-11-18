'use client'
import Link from 'next/link'
import { useState } from 'react'
import type { InboxGroup, InboxItem } from '../lib/inbox'
import { inboxHref, isUnseen, visibleRows, waitingText, type InboxFilters } from '../lib/inbox-view'
import { Zap } from './icons'

const exact = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`

function Row({ i, selected, href, products, unseen }: { i: InboxItem; selected: boolean; href: string; products: boolean; unseen: boolean }) {
  return (
    <Link href={href} aria-current={selected ? 'true' : undefined} data-testid="inbox-row" className="flex h-16 min-w-0 items-center gap-2 overflow-hidden rounded-md border border-transparent px-3 hover:bg-muted aria-[current=true]:border-border aria-[current=true]:bg-muted">
      <span data-slot="unseen" className="size-2 shrink-0">{unseen && <><span className="block size-2 rounded-full bg-primary" aria-hidden /><span className="sr-only">Unread</span></>}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="mono shrink-0 text-muted-foreground">#{i.number}</span>
          <span className="truncate font-medium">{i.decision.title}</span>
          {i.fastLane && <span className="small inline-flex shrink-0 items-center gap-1 text-muted-foreground"><Zap className="size-3.5" />Fast lane</span>}
          <time dateTime={i.decision.openSince} title={exact(i.decision.openSince)} data-overdue={i.overdue || undefined} className="small mono ml-auto shrink-0 text-muted-foreground data-[overdue]:text-warn">{waitingText(i.waiting)}</time>
        </span>
        <span className="small flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="shrink-0">{i.decision.checkpoint}</span>
          <span className="min-w-0 flex-1 truncate">{i.decision.ask}</span>
          {i.asked && <span className="shrink-0">Asked: Product owner</span>}
          {products && <span className="max-w-24 shrink-0 truncate">{i.product.name}</span>}
        </span>
      </span>
    </Link>
  )
}

export function InboxList({ groups, selected, gone, local, filters, workflowHref, products }: { groups: InboxGroup[]; selected?: number; gone: number[]; local: Record<number, boolean>; filters: InboxFilters; workflowHref: Record<string, string>; products: boolean }) {
  const [expanded, setExpanded] = useState<string[]>([])
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((g) => {
        const items = g.items.filter((i) => !gone.includes(i.id))
        const shown = visibleRows(items, selected, expanded.includes(g.checkpoint))
        return (
          <section key={g.checkpoint} aria-label={g.checkpoint} hidden={!items.length} className="flex flex-col gap-1">
            <h2 className="label m-0 flex flex-wrap items-baseline gap-x-3 text-muted-foreground">{g.checkpoint} <span className="font-normal">· {items.length}</span>{workflowHref[g.checkpoint] && <Link href={workflowHref[g.checkpoint]!} className="small font-normal normal-case text-primary">Show in workflow</Link>}</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {shown.map((i) => (
                <li key={i.id} className="min-w-0"><Row i={i} selected={i.id === selected} href={inboxHref(filters, i.id)} products={products} unseen={isUnseen(i, local)} /></li>
              ))}
            </ul>
            {shown.length < items.length && (
              <button type="button" onClick={() => setExpanded((x) => [...x, g.checkpoint])} className="small min-h-11 self-start px-3 text-primary">Show {items.length - shown.length} more</button>
            )}
          </section>
        )
      })}
    </div>
  )
}
