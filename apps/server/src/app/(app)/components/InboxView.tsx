'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { InboxGroup } from '../lib/inbox'
import { announcement, inboxHref, nextRow, redirectHref, type InboxFilters } from '../lib/inbox-view'
import { InboxList } from './InboxList'
import { InboxPane } from './InboxPane'
import { SplitPane } from './SplitPane'

/**
 * The Inbox page body: the list left and the selected decision right from 960px container width, below that the list or, with `?t=`, the detail.
 * Deciding a row removes it and moves the selection (the URL) to the next row.
 */
export function InboxView({ groups, selected, detail, admin, filters, workflowHref }: { groups: InboxGroup[]; selected: number | null; detail: boolean; admin: boolean; filters: InboxFilters; workflowHref: Record<string, string> }) {
  const router = useRouter()
  const [gone, setGone] = useState<number[]>([])
  const [said, setSaid] = useState('')
  const [failed, setFailed] = useState<{ id: number; error: string } | null>(null)
  useEffect(() => {
    const to = redirectHref(location.hash, location.search)
    if (to) router.replace(to)
  }, [router])
  const item = groups.flatMap((g) => g.items).find((i) => i.id === selected)
  const multi = new Set(groups.flatMap((g) => g.items.map((i) => i.product.id))).size > 1
  return (
    <>
    <p role="status" className="small m-0 text-muted-foreground empty:hidden" data-testid="inbox-announce">{said}</p>
    <SplitPane testId="inbox-split" cols="group-data-[wide=true]/split:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] group-data-[wide=true]/split:gap-6">
      <nav aria-label="Decisions" className={`min-w-0 ${detail ? 'group-data-[wide=false]/split:hidden' : ''}`}>
        <InboxList groups={groups} selected={selected ?? undefined} gone={gone} filters={filters} workflowHref={workflowHref} />
      </nav>
      <div className={`min-w-0 ${detail ? '' : 'group-data-[wide=false]/split:hidden'}`}>
        {item && (
          <InboxPane
            item={item}
            admin={admin}
            multi={multi}
            back={inboxHref(filters)}
            failure={failed?.id === item.id ? failed.error : null}
            onDecided={(id, option) => {
              const next = nextRow(groups.map((g) => ({ ...g, items: g.items.filter((i) => !gone.includes(i.id)) })), id)
              setGone((x) => [...x, id])
              setFailed(null)
              setSaid(announcement(option, item.number, next ? groups.flatMap((g) => g.items).find((i) => i.id === next)?.number : undefined))
              router.replace(inboxHref(filters, next), { scroll: false })
            }}
            onFailed={(id, error) => {
              setGone((x) => x.filter((y) => y !== id))
              setSaid('')
              setFailed({ id, error })
              router.replace(inboxHref(filters, id), { scroll: false })
            }}
          />
        )}
      </div>
    </SplitPane>
    </>
  )
}
