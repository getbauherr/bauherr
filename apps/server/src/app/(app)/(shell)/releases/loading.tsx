import { PageLoading, CardsSkeleton, TitleSkeleton } from '../../components/PageLoading'
import { Skeleton } from '../../components/ui/skeleton'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-32" />
      <Skeleton className="h-10 w-72" />
      <CardsSkeleton count={2} />
    </PageLoading>
  )
}
