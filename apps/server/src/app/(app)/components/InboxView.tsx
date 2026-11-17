'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DecisionOption } from '../../../lib/decision'
import type { InboxGroup, InboxItem } from '../lib/inbox'
import { markSeen } from '../lib/actions'
import { announcement, emptyPane, inboxHref, isUnseen, KEY_HELP, keyAction, moveSelection, newRows, redirectHref, removeRow, restoreRow, SEEN_AFTER_MS, selectionChanged, settleRow, syncRows, type InboxFilters, type InboxKey } from '../lib/inbox-view'
import { InboxList } from './InboxList'
import { InboxPane } from './InboxPane'
import { SplitPane } from './SplitPane'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

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
 * A row open for a second is marked seen. Keys (`keyAction`) move the selection, take the pane's primary, open the Ticket, send back, toggle unread, focus the filters, show the key help and go back.
 * A live refresh keeps the selection (it is the URL) and counts the rows it brought in as "N new".
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
  const paneRef = useRef(pane)
  paneRef.current = pane
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
  const [local, setLocal] = useState<Record<number, boolean>>({})
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
  const [help, setHelp] = useState(false)
  const filtersKey = inboxHref(filters)
  const ids = groups.flatMap((g) => g.items.map((i) => i.id))
  const known = useRef<{ key: string; ids: number[] } | null>(null)
  const [fresh, setFresh] = useState<number[]>([])
  useEffect(() => {
    const before = known.current
    known.current = { key: filtersKey, ids }
    setFresh((f) => (before?.key === filtersKey ? [...f.filter((id) => ids.includes(id)), ...newRows([...before.ids, ...f], ids)] : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])
  useEffect(() => { document.querySelector('[data-testid=inbox-row][aria-current=true]')?.scrollIntoView({ block: 'nearest' }) }, [selection])
  const act = useRef<(k: InboxKey) => boolean>(() => false)
  act.current = (key) => {
    const pane = document.querySelector('[data-testid=inbox-pane]')
    const k = keyRef.current
    switch (key) {
      case 'next': case 'prev': {
        const to = moveSelection(ids.filter((id) => !paneRef.current.gone.includes(id)), selectionNow.current, key === 'next' ? 1 : -1)
        if (to) router.replace(inboxHref(filters, to), { scroll: false })
        return true
      }
      case 'primary': {
        const primary = pane?.querySelectorAll<HTMLElement>('[data-primary]')
        if (primary?.length === 1) primary[0]!.click()
        return true
      }
      case 'sendBack': pane?.querySelector<HTMLElement>('[data-send-back]')?.click(); return true
      case 'open': if (k) router.push(`/tickets/${k.ticket}`); return !!k
      case 'unread': if (k) set(k.ticket, unseen.current); return !!k
      case 'filters': document.querySelector<HTMLElement>('[data-testid=inbox-filters] select')?.focus(); return true
      case 'help': setHelp(true); return true
      case 'back': {
        const back = document.querySelector<HTMLElement>('[data-testid=inbox-back]')
        if (!back?.offsetParent) return false
        back.click()
        return true
      }
    }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const key = keyAction(e)
      if (key && act.current(key)) e.preventDefault()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])
  const multi = new Set(groups.flatMap((g) => g.items.map((i) => i.product.id))).size > 1
  const arrived = fresh.filter((id) => id !== selection).length
  return (
    <SplitPane testId="inbox-split" cols="group-data-[wide=true]/split:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] group-data-[wide=true]/split:gap-6" before={
      <>
        <p role="status" data-testid="inbox-new" className="small m-0 mb-2 text-primary" hidden={!arrived}>{arrived ? `${arrived} new` : ''}</p>
        <Dialog open={help} onOpenChange={setHelp}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Keyboard</DialogTitle>
              <DialogDescription>Keys work on the Inbox outside fields and dialogs.</DialogDescription>
            </DialogHeader>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {KEY_HELP.map(([k, what]) => <div key={k} className="contents"><dt className="mono">{k}</dt><dd className="m-0">{what}</dd></div>)}
            </dl>
          </DialogContent>
        </Dialog>
      </>
    }>
      <nav aria-label="Decisions" className={`min-w-0 ${detail || failedHere ? 'group-data-[wide=false]/split:hidden' : ''}`}>
        <InboxList groups={groups} selected={selection ?? undefined} gone={pane.gone} local={local} filters={filters} workflowHref={workflowHref} products={products} />
      </nav>
      <div className={`min-w-0 ${detail || failedHere ? '' : 'group-data-[wide=false]/split:hidden'}`}>
        {pane.failed && <p role="alert" data-testid="decision-error" className="small mb-3 mt-0 text-destructive">Could not decide #{pane.failed.item.number}: {pane.failed.error}</p>}
        {item && <InboxPane item={item} admin={admin} multi={multi} back={inboxHref(filters)} onDecided={onDecided} onSucceeded={onSucceeded} onFailed={onFailed} />}
      </div>
    </SplitPane>
  )
}
