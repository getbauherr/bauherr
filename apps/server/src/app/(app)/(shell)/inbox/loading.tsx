import { GroupsSkeleton } from '../../components/skeletons'

export default function Loading() {
  return (
    <>
      <h1 className="title">Inbox</h1>
      <GroupsSkeleton />
    </>
  )
}
