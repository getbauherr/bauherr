import { GroupsSkeleton } from '../../components/skeletons'

export default function Loading() {
  return (
    <>
      <h1 className="sr-only">Inbox</h1>
      <GroupsSkeleton />
    </>
  )
}
