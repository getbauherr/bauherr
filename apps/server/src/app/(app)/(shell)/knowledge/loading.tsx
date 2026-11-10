import { PageLoading, CardsSkeleton, TitleSkeleton } from '../../components/PageLoading'
import { Skeleton } from '../../components/ui/skeleton'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-36" />
      <Skeleton className="h-9 w-full max-w-md" />
      <CardsSkeleton count={4} />
    </PageLoading>
  )
}
