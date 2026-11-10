import { PageLoading, CardsSkeleton, TitleSkeleton } from '../../../components/PageLoading'
import { Skeleton } from '../../../components/ui/skeleton'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-1/2" />
      <Skeleton className="h-8 w-64" />
      <CardsSkeleton count={3} />
    </PageLoading>
  )
}
