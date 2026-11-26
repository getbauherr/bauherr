import { Skeleton } from './ui/skeleton'

const BUSY = { role: 'status', 'aria-busy': true, 'aria-label': 'Loading' } as const

export function TitleSkeleton({ width = 'w-40' }: { width?: string }) {
  return <Skeleton className={`h-8 ${width}`} />
}

export function GroupsSkeleton({ groups = 4 }: { groups?: number }) {
  return (
    <div className="flex flex-col gap-6" {...BUSY}>
      {Array.from({ length: groups }, (_, group) => (
        <div key={group} className="rounded-md border border-border bg-card">
          <div className="rounded-t-md bg-secondary px-4 py-3">
            <Skeleton className="h-5 w-36 bg-border" />
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:min-w-275 md:grid-cols-6" {...BUSY}>
      {Array.from({ length: 6 }, (_, lane) => (
        <div key={lane} className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" {...BUSY}>
      <TitleSkeleton />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

export function TicketSkeleton() {
  return (
    <div className="flex flex-col gap-6" {...BUSY}>
      <div className="flex flex-col gap-3">
        <TitleSkeleton width="w-2/3" />
        <Skeleton className="h-6 w-full" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  )
}
