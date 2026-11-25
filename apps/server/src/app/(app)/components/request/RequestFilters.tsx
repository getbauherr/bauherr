import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { RequestFilter } from '../../../../core/views/request-status'

const LABELS: Record<RequestFilter, string> = { open: 'Open', live: 'Live', closed: 'Closed', mine: 'Only mine' }

export function RequestFilters({
  product,
  current,
  counts,
}: {
  product: number
  current: RequestFilter
  counts: Record<RequestFilter, number>
}) {
  return (
    <nav aria-label="Filter" className="flex flex-wrap gap-2">
      {(Object.keys(LABELS) as RequestFilter[]).map((filter) => (
        <Link
          key={filter}
          href={`/requests?product=${product}&show=${filter}`}
          aria-current={filter === current ? 'page' : undefined}
          className={cn(
            'small inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5',
            'hover:bg-secondary aria-[current=page]:border-primary aria-[current=page]:bg-secondary',
          )}
        >
          {LABELS[filter]}
          <span className="mono text-muted-foreground">{counts[filter]}</span>
        </Link>
      ))}
    </nav>
  )
}
