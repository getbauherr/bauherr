'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { setView } from '../lib/actions'
import { VIEWS, type View } from '../lib/needs-you'

const names: Record<View, string> = { list: 'List', board: 'Board', runs: 'Runs' }

export function OverviewControls({ view, products }: { view: View; products: { id: number; name: string }[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v)
    return `/?${next}`
  }
  const all = params.get('state') === 'all'
  return (
    <div className="controls">
      <nav className="tabs" aria-label="View">
        {VIEWS.map((v) => (
          <Link key={v} href={href({ view: v })} aria-current={v === view ? 'page' : undefined} onClick={() => void setView(v).catch(() => console.warn('Could not save the view preference'))}>
            {names[v]}
          </Link>
        ))}
      </nav>
      <label className="filter">
        <span className="label muted">Product</span>
        <select value={params.get('product') ?? ''} onChange={(e) => router.push(href({ product: e.target.value || null }))}>
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {view !== 'runs' && (
        <div className="seg" role="group" aria-label="Tickets shown">
          <Link href={href({ state: null })} aria-pressed={!all}>Open</Link>
          <Link href={href({ state: 'all' })} aria-pressed={all}>All</Link>
        </div>
      )}
    </div>
  )
}
