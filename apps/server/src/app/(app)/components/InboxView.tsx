'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { InboxGroup } from '../lib/inbox'
import { markSeen } from '../lib/actions'
import { inboxHref, isUnseen, nextRow, redirectHref, SEEN_AFTER_MS, toggleKey, type InboxFilters } from '../lib/inbox-view'
import { InboxList } from './InboxList'
import { InboxPane } from './InboxPane'
import { SplitPane } from './SplitPane'

/**
 * The Inbox page body: the list left and the selected decision right from 960px container width, below that the list or, with `?t=`, the detail.
 * A row open for a second is marked seen, `u` toggles the selected row. Deciding a row removes it and moves the selection (the URL) to the next row.
 */
export function InboxView({ groups, selected, detail, admin, filters, workflowHref, products }: { groups: InboxGroup[]; selected: number | null; detail: boolean; admin: boolean; filters: InboxFilters; workflowHref: Record<string, string>; products: boolean }) {
  const router = useRouter()
  const [gone, setGone] = useState<number[]>([])
  useEffect(() => {
    const to = redirectHref(location.hash, location.search)
    if (to) router.replace(to)
  }, [router])
  const [local, setLocal] = useState<Record<number, boolean>>({})
  const item = groups.flatMap((g) => g.items).find((i) => i.id === selected)
  const unseen = useRef(false)
  unseen.current = !!item && isUnseen(item, local)
  const key = item && { ticket: item.id, need: item.decision.need, since: item.decision.openSince }
  const keyRef = useRef(key)
  keyRef.current = key
  const set = (ticket: number, seen: boolean) => {
    const k = keyRef.current
    if (!k || k.ticket !== ticket) return
    setLocal((x) => ({ ...x, [ticket]: !seen }))
    void markSeen(k, seen).catch(() => setLocal((x) => ({ ...x, [ticket]: seen })))
  }
  useEffect(() => {
    if (!item?.id || !unseen.current) return
    const id = item.id
    const timer = setTimeout(() => { if (unseen.current) set(id, true) }, SEEN_AFTER_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.decision.need, item?.decision.openSince])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const k = keyRef.current
      if (!k || !toggleKey(e)) return
      e.preventDefault()
      set(k.ticket, unseen.current)
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const multi = new Set(groups.flatMap((g) => g.items.map((i) => i.product.id))).size > 1
  return (
    <SplitPane testId="inbox-split" cols="group-data-[wide=true]/split:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] group-data-[wide=true]/split:gap-6">
      <nav aria-label="Decisions" className={`min-w-0 ${detail ? 'group-data-[wide=false]/split:hidden' : ''}`}>
        <InboxList groups={groups} selected={selected ?? undefined} gone={gone} local={local} filters={filters} workflowHref={workflowHref} products={products} />
      </nav>
      <div className={`min-w-0 ${detail ? '' : 'group-data-[wide=false]/split:hidden'}`}>
        {item && (
          <InboxPane
            item={item}
            admin={admin}
            multi={multi}
            back={inboxHref(filters)}
            onDecided={(id) => {
              setGone((x) => [...x, id])
              router.replace(inboxHref(filters, nextRow(groups.map((g) => ({ ...g, items: g.items.filter((i) => !gone.includes(i.id)) })), id)), { scroll: false })
            }}
            onFailed={(id) => {
              setGone((x) => x.filter((y) => y !== id))
              router.replace(inboxHref(filters, id), { scroll: false })
            }}
          />
        )}
      </div>
    </SplitPane>
  )
}
