'use client'
import { useRouter } from 'next/navigation'
import { inboxHref, type InboxFilters } from '../lib/inbox-view'
import { NativeSelect } from './ui/native-select'

export function InboxFilterBar({ filters, checkpoints, products }: { filters: InboxFilters; checkpoints: { name: string; count: number }[]; products: { id: number; name: string }[] }) {
  const router = useRouter()
  return (
    <div className="flex flex-wrap gap-3" data-testid="inbox-filters">
      <label className="small flex min-w-0 flex-col gap-1 text-muted-foreground">Checkpoint
        <NativeSelect value={filters.checkpoint ?? ''} onChange={(e) => router.push(inboxHref({ ...filters, checkpoint: e.target.value || undefined }))} className="max-w-full">
          <option value="">All checkpoints ({checkpoints.reduce((n, c) => n + c.count, 0)})</option>
          {checkpoints.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
        </NativeSelect>
      </label>
      {products.length > 1 && (
        <label className="small flex min-w-0 flex-col gap-1 text-muted-foreground">Product
          <NativeSelect value={filters.product ?? ''} onChange={(e) => router.push(inboxHref({ ...filters, product: Number(e.target.value) || undefined }))} className="max-w-full">
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </label>
      )}
    </div>
  )
}
