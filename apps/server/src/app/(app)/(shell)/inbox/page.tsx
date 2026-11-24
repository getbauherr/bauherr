import { isProductOwner } from '../../../../lib/people'
import { board } from '../../../../core/views/board'
import { stageStats } from '../../../../core/views/stats'
import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { InboxKeys } from '../../components/inbox/InboxKeys'
import { InboxGroup } from '../../components/inbox/InboxGroup'
import { Badge } from '../../components/ui/badge'
import { GROUPS, groupRows } from '../../lib/inbox'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

const percent = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`)

export default async function Inbox() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace || isProductOwner(user)) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, now: new Date() }
  const [lanes, stats] = await Promise.all([board(payload, filter), stageStats(payload, filter)])
  const rows = groupRows(lanes)
  const { totals } = stats
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Inbox</h1>
        {rows.you.length > 0 && <Badge variant="warn">Waiting for you {rows.you.length}</Badge>}
        <p className="small ml-auto text-muted-foreground">
          Last 30 days: first-pass accept <span className="mono">{percent(totals.firstPassAcceptRate)}</span> ·
          exceptions <span className="mono">{percent(totals.exceptionRate)}</span>
        </p>
      </div>
      <InboxKeys>{GROUPS.map((id) => <InboxGroup key={id} id={id} rows={rows[id]} />)}</InboxKeys>
      <AutoRefresh />
    </>
  )
}
