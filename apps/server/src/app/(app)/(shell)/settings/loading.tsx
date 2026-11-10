import { PageLoading, CardsSkeleton, TitleSkeleton } from '../../components/PageLoading'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-32" />
      <CardsSkeleton count={3} />
    </PageLoading>
  )
}
