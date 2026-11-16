'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DecisionOption } from '../../../lib/decision'
import type { InboxGroup, InboxItem } from '../lib/inbox'
import { announcement, emptyPane, inboxHref, redirectHref, removeRow, restoreRow, selectionChanged, settleRow, syncRows, type InboxFilters } from '../lib/inbox-view'
import { InboxList } from './InboxList'
import { InboxPane } from './InboxPane'
import { SplitPane } from './SplitPane'

const Say = createContext<(text: string) => void>(() => {})

/** The page's live region: mounted for as long as the page is, so the result of the last decision is read even when the list below it is empty. */
export function InboxAnnouncer({ children }: { children: ReactNode }) {
  const [said, setSaid] = useState('')
  return (
    <Say.Provider value={setSaid}>
      <p role="status" className="sr-only" data-testid="inbox-announce">{said}</p>
      {children}
    </Say.Provider>
  )
}

/**
 * The Inbox page body: the list left and the selected decision right from 960px container width, below that the list or, with `?t=`, the detail.
 * Deciding a row removes it at once and moves the selection (the URL) to the next row; the result is announced when the action has succeeded,
 * a failure puts the row back with its error.
 */
export function InboxView({ groups, selected, detail, admin, filters, workflowHref, products }: { groups: InboxGroup[]; selected: number | null; detail: boolean; admin: boolean; filters: InboxFilters; workflowHref: Record<string, string>; products: boolean }) {
  const router = useRouter()
  const say = useContext(Say)
  const t = Number(useSearchParams().get('t')) || null
  const selection = t ?? selected
  const [pane, setPane] = useState(emptyPane)
  const flight = useRef(new Map<number, { item: InboxItem; next: InboxItem | undefined }>())
  const keep = useRef<number[]>([])
  const first = useRef(true)
  const moving = useRef<number | null>(null)
  useEffect(() => {
    const to = redirectHref(location.hash, location.search)
    if (to) router.replace(to)
  }, [router])
  useEffect(() => setPane(syncRows), [groups])
  useEffect(() => {
    setPane((p) => selectionChanged(p, selection))
    if (first.current) first.current = false
    else if (selection !== null && !keep.current.includes(selection)) say('')
    if (selection === moving.current) moving.current = null
  }, [selection, say])
  const selectionNow = useRef(selection)
  selectionNow.current = selection
  const onDecided = useCallback((id: number) => {
    const r = removeRow(pane, groups, id)
    const row = groups.flatMap((g) => g.items).find((i) => i.id === id)
    if (row) flight.current.set(id, { item: row, next: r.next })
    setPane(r.state)
    moving.current = r.next?.id ?? null
    if (r.next) router.replace(inboxHref(filters, r.next.id), { scroll: false })
  }, [pane, groups, filters, router])
  const onSucceeded = useCallback((id: number, option: DecisionOption) => {
    const f = flight.current.get(id)
    flight.current.delete(id)
    keep.current = [id, ...(f?.next ? [f.next.id] : [])]
    setPane((p) => settleRow(p, id))
    if (f) say(announcement(option, f.item.number, f.next?.number))
  }, [say])
  const onFailed = useCallback((id: number, error: string) => {
    const f = flight.current.get(id)
    flight.current.delete(id)
    if (!f) return
    const r = restoreRow(pane, f.item, error, moving.current ?? selectionNow.current, f.next?.id ?? id)
    setPane(r.state)
    if (r.goTo) router.replace(inboxHref(filters, r.goTo), { scroll: false })
  }, [pane, filters, router])
  const failedHere = pane.failed && t === pane.failed.item.id ? pane.failed.item : null
  const item = failedHere ?? groups.flatMap((g) => g.items).find((i) => i.id === selected)
  const multi = new Set(groups.flatMap((g) => g.items.map((i) => i.product.id))).size > 1
  return (
    <SplitPane testId="inbox-split" cols="group-data-[wide=true]/split:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] group-data-[wide=true]/split:gap-6">
      <nav aria-label="Decisions" className={`min-w-0 ${detail || failedHere ? 'group-data-[wide=false]/split:hidden' : ''}`}>
        <InboxList groups={groups} selected={selection ?? undefined} gone={pane.gone} filters={filters} workflowHref={workflowHref} products={products} />
      </nav>
      <div className={`min-w-0 ${detail || failedHere ? '' : 'group-data-[wide=false]/split:hidden'}`}>
        {pane.failed && <p role="alert" data-testid="decision-error" className="small mb-3 mt-0 text-destructive">Could not decide #{pane.failed.item.number}: {pane.failed.error}</p>}
        {item && <InboxPane item={item} admin={admin} multi={multi} back={inboxHref(filters)} onDecided={onDecided} onSucceeded={onSucceeded} onFailed={onFailed} />}
      </div>
    </SplitPane>
  )
}
