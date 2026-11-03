'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tab, Tabs } from './ui/tabs'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const controls = 'flex flex-wrap items-center gap-4 border-b border-border'

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
    <label className="flex items-center gap-2">
      <span className="label text-muted-foreground">Product</span>
      <select className="h-8 rounded-md border border-border bg-secondary px-2 font-[inherit] text-foreground" value={params.get('product') ?? ''} onChange={(e) => router.push(href({ product: e.target.value || null }))}>
        <option value="">All products</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  )
}

export function RunsControls({ products }: { products: { id: number; name: string }[] }) {
  return <div className={controls}><ProductSelect products={products} /></div>
}

export function TicketControls({ products }: { products: { id: number; name: string }[] }) {
  const { params, href } = useHref()
  const all = params.get('state') === 'all'
  const graph = params.get('view') === 'graph'
  return (
    <div className={controls}>
      <Tabs aria-label="Tickets layout" className="mr-auto">
        <Tab href={href({ view: null })} aria-current={graph ? undefined : 'page'}>Board</Tab>
        <Tab href={href({ view: 'graph' })} aria-current={graph ? 'page' : undefined}>Graph</Tab>
      </Tabs>
      <ProductSelect products={products} />
      {!graph && (
        <ToggleGroup aria-label="Tickets shown">
          <ToggleGroupItem href={href({ state: null })} aria-pressed={!all}>Open</ToggleGroupItem>
          <ToggleGroupItem href={href({ state: 'all' })} aria-pressed={all}>All</ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  )
}
