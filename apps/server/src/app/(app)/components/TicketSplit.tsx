'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Button } from './ui/button'

export const SPLIT_MIN = 360
export const SPLIT_MAX = 640
const SPLIT_DEFAULT = 480
const STEP = 16
const KEY = 'bauherr.ticket-split'

/** Clamps a Now pane width to the allowed range. */
export const clampWidth = (w: number): number => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(w)))

type Saved = { width: number; collapsed: boolean }
const read = (): Saved => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>
    return { width: clampWidth(Number(s.width) || SPLIT_DEFAULT), collapsed: s.collapsed === true }
  } catch {
    return { width: SPLIT_DEFAULT, collapsed: false }
  }
}
const write = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {}
}

/**
 * The Ticket page's split: the conversation left, the Now pane right. At container width of 960px and up both show, the handle between them resizes the Now pane
 * (360-640px, drag or arrow keys; Enter collapses) and width and collapsed state are remembered. Below 960px two tabs switch between them.
 * `bar` is the Now pane's ActionBar: it stays on screen on every tab (fixed to the bottom at 640px and below).
 */
export function TicketSplit({ conversation, bar, now, defaultTab = 'status' }: { conversation: ReactNode; bar: ReactNode; now: ReactNode; defaultTab?: 'conversation' | 'status' }) {
  const [saved, setSaved] = useState<Saved>({ width: SPLIT_DEFAULT, collapsed: false })
  const [tab, setTab] = useState(defaultTab)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => setSaved(read()), [])
  // Container width without `container-type`, which would contain the fixed ActionBar to this box.
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e!.contentRect.width >= 960))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // A link to #details shows the Now tab of the Now pane with About open.
  useEffect(() => {
    const show = () => {
      setTab('status')
      setSaved((s) => ({ ...s, collapsed: false }))
      setTimeout(() => {
        document.getElementById('pane-tab-now')?.click()
        document.querySelector<HTMLDetailsElement>('[data-testid=ticket-about]')?.setAttribute('open', '')
        document.getElementById('details')?.scrollIntoView()
      }, 0)
    }
    const click = (e: MouseEvent) => {
      if ((e.target as Element).closest('a[href="#details"]')) {
        e.preventDefault()
        show()
      }
    }
    document.addEventListener('click', click)
    if (location.hash === '#details') show()
    return () => document.removeEventListener('click', click)
  }, [])
  const update = useCallback((s: Saved) => {
    setSaved(s)
    write(s)
  }, [])

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || !root.current) return
    const right = root.current.getBoundingClientRect().right
    setSaved((s) => ({ ...s, width: clampWidth(right - e.clientX) }))
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const w = saved.width
    if (e.key === 'ArrowLeft') update({ collapsed: false, width: clampWidth(w + STEP) })
    else if (e.key === 'ArrowRight') update({ collapsed: false, width: clampWidth(w - STEP) })
    else if (e.key === 'Home') update({ collapsed: false, width: SPLIT_MIN })
    else if (e.key === 'End') update({ collapsed: false, width: SPLIT_MAX })
    else if (e.key === 'Enter') update({ ...saved, collapsed: !saved.collapsed })
    else return
    e.preventDefault()
  }

  const narrowHidden = (show: boolean) => (show ? '' : 'group-data-[wide=false]/split:hidden')
  return (
    <div ref={root} className="group/split" data-testid="ticket-split" data-wide={wide} data-collapsed={saved.collapsed}>
      <div role="tablist" aria-label="Ticket page" className="mb-3 flex gap-4 border-b border-border group-data-[wide=true]/split:hidden">
        {([['conversation', 'Conversation'], ['status', 'Status']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`split-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`split-${id}`}
            data-testid={`split-tab-${id}`}
            onClick={() => setTab(id)}
            className="-mb-px h-11 border-b-2 border-transparent text-muted-foreground aria-selected:border-primary aria-selected:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={`grid items-start gap-0 ${saved.collapsed ? 'group-data-[wide=true]/split:grid-cols-[minmax(0,1fr)_1.25rem]' : 'group-data-[wide=true]/split:grid-cols-[minmax(0,1fr)_1.25rem_var(--now-w)]'}`}
        style={{ '--now-w': `${saved.width}px` } as CSSProperties}
      >
        <section id="split-conversation" role="tabpanel" aria-labelledby="split-tab-conversation" aria-label="Conversation" data-testid="split-conversation" className={`group-data-[wide=true]/split:sticky group-data-[wide=true]/split:top-[var(--space-4)] min-w-0 ${narrowHidden(tab === 'conversation')}`}>
          {conversation}
        </section>
        <div className="hidden h-full min-h-[12rem] items-start justify-center group-data-[wide=true]/split:flex">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the Now pane"
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-valuenow={saved.collapsed ? 0 : saved.width}
            tabIndex={0}
            data-testid="split-handle"
            title="Drag or use the arrow keys to resize, Enter to collapse"
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={drag}
            onPointerUp={() => update(saved)}
            onKeyDown={key}
            className="sticky top-[var(--space-4)] h-[calc(100dvh-8rem)] min-h-[24rem] w-1.5 cursor-col-resize rounded-full bg-border outline-none hover:bg-primary/40 focus-visible:bg-primary"
          />
        </div>
        <aside id="split-status" role="tabpanel" aria-labelledby="split-tab-status" aria-label="Now" data-testid="now-pane" className={`flex min-w-0 flex-col gap-4 ${saved.collapsed ? 'group-data-[wide=true]/split:hidden' : ''} ${tab === 'status' ? '' : 'group-data-[wide=false]/split:gap-0'}`}>
          {bar}
          <div className={`flex min-w-0 flex-col gap-4 ${narrowHidden(tab === 'status')}`}>{now}</div>
        </aside>
      </div>
      {saved.collapsed && (
        <Button type="button" variant="outline" size="sm" className="mt-3 hidden group-data-[wide=true]/split:inline-flex" data-testid="split-expand" onClick={() => update({ ...saved, collapsed: false })}>Show the Now pane</Button>
      )}
    </div>
  )
}

/** The Now pane's tabs (Now, Plan, Proof, History): documents never share the screen with the status. The pane never switches by itself. */
export function PaneTabs({ tabs }: { tabs: { id: string; label: string; body: ReactNode }[] }) {
  const [current, setCurrent] = useState(tabs[0]!.id)
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (n === null) return
    e.preventDefault()
    const next = tabs[(n + tabs.length) % tabs.length]!
    setCurrent(next.id)
    document.getElementById(`pane-tab-${next.id}`)?.focus()
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" id="details">
      <div role="tablist" aria-label="Ticket documents" className="flex gap-4 border-b border-border">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`pane-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`pane-${t.id}`}
            tabIndex={current === t.id ? 0 : -1}
            data-testid={`pane-tab-${t.id}`}
            onClick={() => setCurrent(t.id)}
            onKeyDown={(e) => move(e, i)}
            className="-mb-px h-11 border-b-2 border-transparent text-muted-foreground aria-selected:border-primary aria-selected:text-foreground"
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`pane-${t.id}`} aria-labelledby={`pane-tab-${t.id}`} hidden={current !== t.id} className="flex min-w-0 flex-col gap-4">{t.body}</div>
      ))}
    </div>
  )
}
