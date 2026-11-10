import type { ReactNode } from 'react'
import { Skeleton } from './ui/skeleton'

/** Static skeleton shell of every `loading.tsx`: no client JS, shown the moment a navigation starts. */
export function PageLoading({ children, label = 'Loading' }: { children: ReactNode; label?: string }) {
  return (
    <div data-testid="page-loading" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only" role="status">{label}</span>
      {children}
    </div>
  )
}

export const TitleSkeleton = ({ width = 'w-40' }: { width?: string }) => <Skeleton className={`h-7 ${width}`} />

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-px border border-border bg-border">
      {Array.from({ length: rows + 1 }, (_, r) => (
        <div key={r} className="grid gap-4 bg-card px-4 py-3" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={r ? 'h-4' : 'h-3 w-1/2'} />)}
        </div>
      ))}
    </div>
  )
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function BoardSkeleton() {
  return (
    <div className="grid grid-cols-6 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
      {Array.from({ length: 6 }, (_, c) => (
        <div key={c} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-1/2" />
          {Array.from({ length: 3 - (c % 3) }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ))}
    </div>
  )
}
