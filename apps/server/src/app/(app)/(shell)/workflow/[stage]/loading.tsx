import { Skeleton } from '../../../components/ui/skeleton'

export default function Loading() {
  return (
    <div role="status" aria-label="Loading the stage" className="flex flex-col gap-4" data-testid="stage-loading">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="flex flex-wrap gap-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full sm:w-58" />)}
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
