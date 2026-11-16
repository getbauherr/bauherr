'use client'
import Link from 'next/link'
import type { InboxGroup } from '../lib/inbox'
import { inboxHref, type InboxFilters } from '../lib/inbox-view'

/** The Inbox rows by checkpoint, one link each; the selected row (`?t=`) is marked. A decided row leaves at once (`gone`, the server refresh follows). */
export function InboxList({ groups, selected, gone, filters, workflowHref }: { groups: InboxGroup[]; selected?: number; gone: number[]; filters: InboxFilters; workflowHref: Record<string, string> }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((g) => {
        const items = g.items.filter((i) => !gone.includes(i.id))
        return (
          <section key={g.checkpoint} aria-label={g.checkpoint} hidden={!items.length} className="flex flex-col gap-1">
            <h2 className="label m-0 flex flex-wrap items-baseline gap-x-3 text-muted-foreground">{g.checkpoint} <span className="font-normal">· {items.length}</span>{workflowHref[g.checkpoint] && <Link href={workflowHref[g.checkpoint]!} className="small font-normal normal-case text-primary">Show in workflow</Link>}</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {items.map((i) => (
                <li key={i.id} className="min-w-0">
                  <Link href={inboxHref(filters, i.id)} aria-current={i.id === selected ? 'true' : undefined} data-testid="inbox-row" className="flex min-h-11 min-w-0 flex-col justify-center rounded-md border border-transparent px-3 py-2 hover:bg-muted aria-[current=true]:border-border aria-[current=true]:bg-muted">
                    <span className="truncate font-medium">#{i.number} {i.decision.title}</span>
                    <span className="small truncate text-muted-foreground">{i.decision.ask} · {i.waiting}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
