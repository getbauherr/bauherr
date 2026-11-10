import { PageLoading, TableSkeleton, TitleSkeleton } from '../../components/PageLoading'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-24" />
      <TableSkeleton rows={8} />
    </PageLoading>
  )
}
