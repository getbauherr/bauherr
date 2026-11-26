import { Suspense } from 'react'
import { isProductOwner } from '../../../../lib/people'
import { board } from '../../../../core/views/board'
import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { InboxGroups, InboxTotals, WaitingBadge } from '../../components/inbox/InboxSections'
import { GroupsSkeleton } from '../../components/skeletons'
import { Skeleton } from '../../components/ui/skeleton'
import { BOARD_TABLES } from '../../lib/change-tables'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Inbox() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace || isProductOwner(user)) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, now: new Date() }
  const lanes = board(payload, filter)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Inbox</h1>
        <Suspense>
          <WaitingBadge lanes={lanes} />
        </Suspense>
        <Suspense fallback={<Skeleton className="ml-auto h-4 w-64" />}>
          <InboxTotals payload={payload} filter={filter} />
        </Suspense>
      </div>
      <Suspense fallback={<GroupsSkeleton />}>
        <InboxGroups lanes={lanes} />
      </Suspense>
      <AutoRefresh tables={BOARD_TABLES} />
    </>
  )
}
