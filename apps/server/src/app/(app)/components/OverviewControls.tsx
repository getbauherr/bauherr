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

export function RunsControls({ products }: { products: { id: number; name: string }[] }) {
  return <div className="controls"><ProductSelect products={products} /></div>
}

export function TicketControls({ products }: { products: { id: number; name: string }[] }) {
  const { params, href } = useHref()
  const all = params.get('state') === 'all'
  return (
    <div className="controls">
      <ProductSelect products={products} />
      <div className="seg" role="group" aria-label="Tickets shown">
        <Link href={href({ state: null })} aria-pressed={!all}>Open</Link>
        <Link href={href({ state: 'all' })} aria-pressed={all}>All</Link>
      </div>
    </div>
  )
}
