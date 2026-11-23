import { mayDecide } from '../../../../core/decide'
import { isProductOwner } from '../../../../lib/people'
import { board } from '../../../../core/views/board'
import { stageStats } from '../../../../core/views/stats'
import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { InboxAdvance } from '../../components/inbox/InboxAdvance'
import { InboxKeys } from '../../components/inbox/InboxKeys'
import { InboxGroup } from '../../components/inbox/InboxGroup'
import { InboxPane } from '../../components/inbox/InboxPane'
import { Badge } from '../../components/ui/badge'
import { GROUPS, groupRows, selectedTicket, waitingIds } from '../../lib/inbox'
import { cn } from '@/lib/utils'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

const percent = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`)

type Props = { searchParams: Promise<{ t?: string }> }

export default async function Inbox({ searchParams }: Props) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace || isProductOwner(user)) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, now: new Date() }
  const [lanes, stats] = await Promise.all([board(payload, filter), stageStats(payload, filter)])
  const rows = groupRows(lanes)
  const { totals } = stats
  const view = await selectedTicket(payload, workspace.id, (await searchParams).t)
  const selected = view?.recordId ?? null
  const split = view !== null
  const may = mayDecide({ id: String(user.id), role: user.role, workspaceIds: [workspace.id] }, workspace.id)
  return (
    <div className={split ? 'grid items-start gap-6 lg:grid-cols-[420px_minmax(0,1fr)]' : 'grid gap-6'}>
      <div className="grid min-w-0 content-start gap-6">
        <div className={cn('flex flex-wrap items-center gap-3', split && 'max-lg:sr-only')}>
          <h1 className="title">Inbox</h1>
          {rows.you.length > 0 && <Badge variant="warn">Waiting for you {rows.you.length}</Badge>}
          <p className="small ml-auto text-muted-foreground">
            Last 30 days: first-pass accept <span className="mono">{percent(totals.firstPassAcceptRate)}</span> ·
            exceptions <span className="mono">{percent(totals.exceptionRate)}</span>
          </p>
        </div>
        <InboxKeys>
          <div className={cn('grid gap-6', split && 'max-lg:hidden')}>
            {GROUPS.map((id) => (
              <InboxGroup key={id} id={id} rows={rows[id]} selected={selected} split={split} />
            ))}
          </div>
        </InboxKeys>
      </div>
      {view && <InboxPane view={view} may={may} />}
      <InboxAdvance waiting={waitingIds(rows.you)} selected={selected} />
      <AutoRefresh />
    </div>
  )
}
