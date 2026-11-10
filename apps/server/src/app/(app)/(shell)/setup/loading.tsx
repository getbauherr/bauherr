import { PageLoading, CardsSkeleton, TitleSkeleton } from '../../components/PageLoading'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-48" />
      <CardsSkeleton count={2} />
    </PageLoading>
  )
}
