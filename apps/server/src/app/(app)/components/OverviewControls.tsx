'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

function useHref() {
  const path = usePathname()
  const params = useSearchParams()
  return { params, href: (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v)
    return `${path}?${next}`
  } }
}

function ProductSelect({ products }: { products: { id: number; name: string }[] }) {
  const router = useRouter()
  const { params, href } = useHref()
  return (
    <label className="filter">
      <span className="label muted">Product</span>
      <select value={params.get('product') ?? ''} onChange={(e) => router.push(href({ product: e.target.value || null }))}>
        <option value="">All products</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  )
}

type Epics = { id: number; number: number; title: string }[]

function EpicSelect({ epics }: { epics: Epics }) {
  const router = useRouter()
  const { params, href } = useHref()
  return epics.length ? (
    <label className="filter">
      <span className="label muted">Epic</span>
      <select value={params.get('epic') ?? ''} onChange={(e) => router.push(href({ epic: e.target.value }))}>
        <option value="">All</option>
        {epics.map((e) => <option key={e.id} value={e.id}>#{e.number} {e.title}</option>)}
      </select>
    </label>
  ) : null
}

export function RunsControls({ products, epics }: { products: { id: number; name: string }[]; epics: Epics }) {
  return <div className="controls"><ProductSelect products={products} /><EpicSelect epics={epics} /></div>
}

export function TicketControls({ products, epics }: { products: { id: number; name: string }[]; epics: Epics }) {
  const { params, href } = useHref()
  const all = params.get('state') === 'all'
  const view = params.get('view')
  const graph = view === 'graph'
  const list = view === 'epics'
  const done = params.get('done') === '1'
  return (
    <div className="controls">
      <nav className="tabs" aria-label="Tickets layout">
        <Link href={href({ view: null })} aria-current={graph || list ? undefined : 'page'}>Board</Link>
        <Link href={href({ view: 'graph' })} aria-current={graph ? 'page' : undefined}>Graph</Link>
        <Link href={href({ view: 'epics', epic: null })} aria-current={list ? 'page' : undefined}>Epics</Link>
      </nav>
      <ProductSelect products={products} />
      {!list && <EpicSelect epics={epics} />}
      {list && (
        <div className="seg" role="group" aria-label="Epics shown">
          <Link href={href({ done: done ? null : '1' })} aria-pressed={done}>Show done</Link>
        </div>
      )}
      {!graph && !list && (
        <div className="seg" role="group" aria-label="Tickets shown">
          <Link href={href({ state: null })} aria-pressed={!all}>Open</Link>
          <Link href={href({ state: 'all' })} aria-pressed={all}>All</Link>
        </div>
      )}
    </div>
  )
}
