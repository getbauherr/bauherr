import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { Table } from '../../../components/ui/table'
import { isAdmin, loadHealth, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { ago } from '../../../lib/format'
import { CAUSE_LABEL } from '../../../lib/needs-you'
import { savedGrafanaUrl } from '../../../../../lib/monitoring'

export const dynamic = 'force-dynamic'

export default async function Health() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const [health, w] = await Promise.all([loadHealth(workspace.id), loadWorkspaceSettings(workspace.id)])
  const spend = w.spend
  const grafana = await savedGrafanaUrl(await payloadClient())
  const budget = !w.gatewayOn ? ['Gateway off', 'text-muted-foreground'] : !spend ? ['Unavailable', 'text-muted-foreground'] : spend.limitUsd == null ? ['No limit', 'text-ok'] : spend.spentUsd >= spend.limitUsd ? ['Exhausted', 'text-destructive'] : spend.spentUsd >= 0.8 * spend.limitUsd ? ['Near limit', 'text-warn'] : ['OK', 'text-ok']
  return (
    <>
      <h2 className="heading">Health</h2>
      <Table>
          <tbody>
            <tr><th>Jobs, last 24 h (instance-wide)</th><td>{health.queued} queued · {health.running} running · <span className={health.failed ? 'text-destructive' : ''}>{health.failed} failed{health.failed ? ' (needs attention)' : ''}</span></td></tr>
            <tr><th>Oldest queued job (instance-wide)</th><td>{health.oldestQueued ? ago(health.oldestQueued) : 'none waiting'}</td></tr>
            <tr><th>Dead tickets</th><td>{!health.dead ? <span className="text-muted-foreground">Could not be checked right now.</span> : <span className={health.dead.length ? 'text-destructive' : ''}>{health.dead.length}</span>}{health.dead?.map((d) => <span key={d.id}> · <Link href={`/tickets/${d.id}`}>#{d.number}</Link> ({CAUSE_LABEL[d.cause] ?? d.cause})</span>)}</td></tr>
            {health.sources.map((s) => (
              <tr key={s.repo}>
                <th>Last poll, {s.repo}</th>
                <td>{s.polledAt ? ago(s.polledAt) : 'never'}{s.error && <span className="text-destructive"> · Failed: {s.error}</span>}</td>
              </tr>
            ))}
            {health.forge.nobodyLinked && <tr><th>Forge decisions</th><td><span className="text-destructive">No Bauherr or Admin of this Workspace has linked a forge login.</span> A label or answers comment on the forge counts only from a linked login, so none will count until someone links theirs on their profile. Approving on the Ticket page still works.</td></tr>}
            {health.forge.unlinked.map((u) => <tr key={u.product}><th>Unlinked approvers, {u.product}</th><td><span className="text-warn">{u.logins.map((l) => `@${l}`).join(', ')}</span> named as approvers before and have no account, so they no longer count. Link each login on the person&apos;s profile (or under People).</td></tr>)}
            <tr><th>Expedite lead time (last 5)</th><td>{health.expediteLeadMs == null ? <span className="text-muted-foreground">No Hotfix merged yet.</span> : `${Math.max(1, Math.round(health.expediteLeadMs / 6e4))} min from flag to merge`}</td></tr>
            {grafana && <tr><th>Grafana</th><td><a href={grafana} target="_blank" rel="noreferrer">Open dashboards</a></td></tr>}
            <tr><th>Gateway budget</th><td><span className={budget[1]}>{budget[0]}</span>{spend ? ` · $${spend.spentUsd.toFixed(2)}${spend.limitUsd == null ? '' : ` of $${spend.limitUsd}`}` : ''}</td></tr>
          </tbody>
      </Table>
      <h3 className="heading">Flaky checks</h3>
      {health.flakes.length ? (
        <Table>
            <thead><tr className="label"><th>Check</th><th>Passed after retry</th><th>Last seen</th><th>Ticket</th></tr></thead>
            <tbody>
              {health.flakes.map((f) => (
                <tr key={f.check}><td className="mono">{f.check}</td><td>{f.count}</td><td>{ago(f.lastSeen)}</td><td>{f.ticket ? `#${f.ticket}` : ''}</td></tr>
              ))}
            </tbody>
        </Table>
      ) : (
        <p className="small text-muted-foreground">No check passed after a retry in the last 30 days.</p>
      )}
    </>
  )
}
