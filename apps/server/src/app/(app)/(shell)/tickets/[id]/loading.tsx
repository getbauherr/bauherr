import { PageLoading, CardsSkeleton, TitleSkeleton } from '../../../components/PageLoading'
import { Skeleton } from '../../../components/ui/skeleton'

export default function Loading() {
  return (
    <PageLoading>
      <Skeleton className="h-12 w-full" />
      <TitleSkeleton width="w-2/3" />
      <Skeleton className="h-8 w-full" />
      <CardsSkeleton count={2} />
    </PageLoading>
  )
}
