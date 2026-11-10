import { BoardSkeleton, PageLoading, TitleSkeleton } from '../components/PageLoading'

export default function Loading() {
  return (
    <PageLoading>
      <TitleSkeleton />
      <BoardSkeleton />
    </PageLoading>
  )
}
