import { PageLoading, TableSkeleton, TitleSkeleton } from '../../components/PageLoading'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton width="w-32" />
      <TableSkeleton rows={6} cols={3} />
    </PageLoading>
  )
}
