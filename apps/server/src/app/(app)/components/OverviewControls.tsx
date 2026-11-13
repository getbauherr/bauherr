'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createContext, useContext, useTransition, type ReactNode } from 'react'
import { GenerationLoader } from './ui/loading-state'
import { Tab, Tabs } from './ui/tabs'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const controls = 'flex flex-wrap items-center gap-4 border-b border-border'
const select = 'h-8 rounded-md border border-border bg-secondary px-2 font-[inherit] text-foreground'

function useHref() {
  const path = usePathname()
  const params = useSearchParams()
  return { params, href: (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v)
    return `${path}?${next}`
  } }
}

const Navigating = createContext<(href: string) => void>(() => {})

/** Wraps the controls: a select change navigates in a transition, so the row shows `aria-busy` and a loader until the new data arrived. */
function Pending({ className, children }: { className: string; children: ReactNode }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className={className} aria-busy={pending} data-testid="overview-controls">
      <Navigating.Provider value={(href) => start(() => router.push(href))}>{children}</Navigating.Provider>
      {pending && <GenerationLoader label="Loading" className="ml-auto" />}
    </div>
  )
}

function ProductSelect({ products }: { products: { id: number; name: string }[] }) {
  const go = useContext(Navigating)
  const { params, href } = useHref()
  return products.length > 1 || params.get('product') ? (
    <label className="flex items-center gap-2">
      <span className="label text-muted-foreground">Product</span>
      <select className={select} value={params.get('product') ?? ''} onChange={(e) => go(href({ product: e.target.value || null }))}>
        <option value="">All products</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  ) : null
}

type Epics = { id: number; number: number; title: string }[]

function EpicSelect({ epics }: { epics: Epics }) {
  const go = useContext(Navigating)
  const { params, href } = useHref()
  return epics.length ? (
    <label className="flex items-center gap-2">
      <span className="label text-muted-foreground">Epic</span>
      <select className={select} value={params.get('epic') ?? ''} onChange={(e) => go(href({ epic: e.target.value }))}>
        <option value="">All</option>
        {epics.map((e) => <option key={e.id} value={e.id}>#{e.number} {e.title}</option>)}
      </select>
    </label>
  ) : null
}

export function RunsControls({ products, epics }: { products: { id: number; name: string }[]; epics: Epics }) {
  return products.length > 1 || epics.length ? <Pending className={controls}><ProductSelect products={products} /><EpicSelect epics={epics} /></Pending> : null
}

export function TicketControls({ products, epics }: { products: { id: number; name: string }[]; epics: Epics }) {
  const { params, href } = useHref()
  const all = params.get('state') === 'all'
  const view = params.get('view')
  const graph = view === 'graph'
  const list = view === 'epics'
  const done = params.get('done') === '1'
  return (
    <Pending className={controls}>
      <Tabs aria-label="Tickets layout" className="mr-auto">
        <Tab href={href({ view: null })} aria-current={graph || list ? undefined : 'page'}>Workflow</Tab>
        <Tab href={href({ view: 'graph' })} aria-current={graph ? 'page' : undefined}>Graph</Tab>
        <Tab href={href({ view: 'epics', epic: null })} aria-current={list ? 'page' : undefined}>Epics</Tab>
      </Tabs>
      <ProductSelect products={products} />
      {!list && <EpicSelect epics={epics} />}
      {list && (
        <ToggleGroup aria-label="Epics shown">
          <ToggleGroupItem href={href({ done: done ? null : '1' })} aria-current={done ? 'true' : 'false'}>Show done</ToggleGroupItem>
        </ToggleGroup>
      )}
      {!graph && !list && (
        <ToggleGroup aria-label="Tickets shown">
          <ToggleGroupItem href={href({ state: all ? null : 'all' })} aria-current={all ? 'true' : 'false'}>Show done</ToggleGroupItem>
        </ToggleGroup>
      )}
    </Pending>
  )
}

export function InsightsControls({ products, days, ranges }: { products: { id: number; name: string }[]; days: number; ranges: readonly number[] }) {
  const { href } = useHref()
  return (
    <Pending className={controls}>
      <Tabs aria-label="Range" className="mr-auto">
        {ranges.map((r) => <Tab key={r} href={href({ range: String(r) })} aria-current={r === days ? 'page' : undefined}>{r} days</Tab>)}
      </Tabs>
      <ProductSelect products={products} />
    </Pending>
  )
}
