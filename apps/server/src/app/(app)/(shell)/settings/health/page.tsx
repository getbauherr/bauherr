import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { Table } from '../../../components/ui/table'
import { isAdmin, loadHealth, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { ago } from '../../../lib/format'

export const dynamic = 'force-dynamic'

type Spend = Awaited<ReturnType<typeof loadWorkspaceSettings>>['spend']

const budgetBadge = (gatewayOn: boolean, spend: Spend): [string, string] => {
  if (!gatewayOn) return ['Gateway off', 'text-muted-foreground']
  if (!spend) return ['Unavailable', 'text-muted-foreground']
  if (spend.limitUsd == null) return ['No limit', 'text-ok']
  if (spend.spentUsd >= spend.limitUsd) return ['Exhausted', 'text-destructive']
  if (spend.spentUsd >= 0.8 * spend.limitUsd) return ['Near limit', 'text-warn']
  return ['OK', 'text-ok']
}

function HealthTable({
  health,
  spend,
  badge,
}: {
  health: Awaited<ReturnType<typeof loadHealth>>
  spend: Spend
  badge: [string, string]
}) {
  return (
    <Table>
      <tbody>
        <tr>
          <th>Jobs, last 24 h (instance-wide)</th>
          <td>
            {health.queued} queued · {health.running} running ·{' '}
            <span className={health.failed ? 'text-destructive' : ''}>
              {health.failed} failed{health.failed ? ' (needs attention)' : ''}
            </span>
          </td>
        </tr>
        <tr>
          <th>Oldest queued job (instance-wide)</th>
          <td>{health.oldestQueued ? ago(health.oldestQueued) : 'none waiting'}</td>
        </tr>
        {health.sources.map((s) => (
          <tr key={s.repo}>
            <th>Last poll, {s.repo}</th>
            <td>
              {s.polledAt ? ago(s.polledAt) : 'never'}
              {s.error && <span className="text-destructive"> · Failed: {s.error}</span>}
            </td>
          </tr>
        ))}
        <tr>
          <th>Gateway budget</th>
          <td>
            <span className={badge[1]}>{badge[0]}</span>
            {spend ? ` · $${spend.spentUsd.toFixed(2)}${spend.limitUsd == null ? '' : ` of $${spend.limitUsd}`}` : ''}
          </td>
        </tr>
      </tbody>
    </Table>
  )
}

export default async function Health() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const [health, w] = await Promise.all([loadHealth(workspace.id), loadWorkspaceSettings(workspace.id)])
  return (
    <>
      <h2 className="heading">Health</h2>
      <HealthTable health={health} spend={w.spend} badge={budgetBadge(w.gatewayOn, w.spend)} />
    </>
  )
}
