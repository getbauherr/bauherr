import { Suspense } from 'react'
import { isProductOwner } from '../../../../lib/people'
import { heldOf } from '../../../../core/views/board'
import { loadInbox } from '../../../../core/views/inbox'
import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { InboxGroups, InboxTotals, WaitingBadge } from '../../components/inbox/InboxSections'
import { GroupsSkeleton } from '../../components/skeletons'
import { Skeleton } from '../../components/ui/skeleton'
import { BOARD_TABLES } from '../../lib/change-tables'
import { INBOX_PAGE } from '../../lib/inbox'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Inbox() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace || isProductOwner(user)) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, now: new Date() }
  const inbox = loadInbox(payload, filter, INBOX_PAGE)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Inbox</h1>
        <Suspense>
          <WaitingBadge inbox={inbox} />
        </Suspense>
        <Suspense fallback={<Skeleton className="ml-auto h-4 w-64" />}>
          <InboxTotals payload={payload} filter={filter} />
        </Suspense>
      </div>
      <Suspense fallback={<GroupsSkeleton />}>
        <InboxGroups inbox={inbox} held={heldOf(payload, filter)} />
      </Suspense>
      <AutoRefresh tables={BOARD_TABLES} />
    </>
  )
}
