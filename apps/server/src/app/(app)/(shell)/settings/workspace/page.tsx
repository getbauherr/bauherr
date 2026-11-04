import Link from 'next/link'
import { EmptyState } from '../../../components/EmptyState'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { isAdmin, loadHealth, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { ago } from '../../../lib/format'
import { createWorkspace, rotateWorkspaceKey, saveWorkspace } from '../actions'

export const dynamic = 'force-dynamic'

const NewWorkspace = () => (
  <section id="new-workspace" className="stack">
    <h2 className="heading">New Workspace</h2>
    <SettingsForm action={createWorkspace} submit="Create Workspace" reset>
      <div className="pair">
        <Field name="name" label="Name" required />
        <Field name="slug" label="Slug" hint="Lowercase letters, digits and dashes; defaults to the name." />
      </div>
    </SettingsForm>
  </section>
)

export default async function WorkspaceSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return (
    <>
      <EmptyState text="You have no Workspace yet." />
      {isAdmin(user) && <NewWorkspace />}
    </>
  )
  const w = await loadWorkspaceSettings(workspace.id)
  const admin = isAdmin(user)
  const usd = !admin || w.budgetUnit === 'usd'
  const health = admin ? await loadHealth(workspace.id) : null
  const spend = w.spend
  const budget = !admin ? ([] as string[]) : !w.gatewayOn ? ['Gateway off', 'muted'] : !spend ? ['Unavailable', 'muted'] : spend.limitUsd == null ? ['No limit', 'ok'] : spend.spentUsd >= spend.limitUsd ? ['Exhausted', 'err'] : spend.spentUsd >= 0.8 * spend.limitUsd ? ['Near limit', 'warn'] : ['OK', 'ok']
  return (
    <>
      <h2 className="heading">{w.name}</h2>
      <SettingsForm action={saveWorkspace} primary>
        {admin && <Field name="name" label="Name" defaultValue={w.name} />}
        <div className="pair">
          <Field name="budgetUnit" label="Budget unit" options={admin ? [['usd', 'USD'], ['tokens', 'Tokens']] : [['usd', 'USD']]} defaultValue={usd ? 'usd' : w.budgetUnit} />
          <Field name="budgetAmount" label="Budget per 30 days" type="number" min={0} step="any" defaultValue={usd ? w.budgetUsd30d ?? '' : w.budgetTokens30d ?? ''} />
        </div>
        {admin && <p className="small muted">{w.gatewayOn ? (w.spend ? `Spent in the last 30 days: $${w.spend.spentUsd.toFixed(2)}` : 'Spend unavailable.') : 'Gateway off: spend is not tracked.'}</p>}
        {admin && (
          <>
        <section id="tiers" className="stack">
          <h2 className="heading">Model tiers{w.tiersRequired ? '' : ' (empty = preset default)'}</h2>
          <div className="pair three">
            {(['cheap', 'standard', 'strong'] as const).map((t) => (
              <Field key={t} name={`tier_${t}`} label={t[0].toUpperCase() + t.slice(1)} defaultValue={w.modelByTier[t] ?? ''} placeholder={w.placeholders[t]} required={w.tiersRequired} />
            ))}
          </div>
        </section>
        <section id="run-mode" className="stack">
          <h2 className="heading">Run mode</h2>
          <div className="pair three">
            <Field name="defaultMode" label="Default" options={['session', 'autonomous']} empty="inherit" defaultValue={w.defaultMode} />
            {(['plan', 'build'] as const).map((t) => (
              <Field key={t} name={`mode_${t}`} label={`Stage ${t}`} options={['session', 'autonomous']} empty="default" defaultValue={w.modeByStage[t] ?? ''} />
            ))}
          </div>
        </section>
        <section id="knowledge" className="stack">
          <h2 className="heading">Knowledge repo</h2>
          <div className="pair">
            <Field name="knowledgeConnection" label="Connection" options={w.githubConnections} empty="none" defaultValue={w.knowledgeConnection} />
            <Field name="knowledgeRepo" label="Repository (owner/name)" defaultValue={w.knowledgeRepo} placeholder="acme/knowledge" />
          </div>
        </section>
          </>
        )}
      </SettingsForm>
      {admin && <NewWorkspace />}
      {health && (
        <>
          <section id="gateway" className="stack">
            <h2 className="heading">Gateway key</h2>
            {!w.gatewayOn ? (
              <p className="small muted">Gateway off: there is no key to rotate.</p>
            ) : (
              <SettingsForm action={rotateWorkspaceKey} submit="Rotate key" confirm="Confirm rotate" inline>
                <p className="small muted">Issues a new consumer key at the gateway and invalidates the old one.</p>
              </SettingsForm>
            )}
          </section>
          <section id="health" className="stack">
          <h2 className="heading">Factory health</h2>
          <div className="scroll">
            <table className="table">
              <tbody>
                <tr><th>Jobs, last 24 h (instance-wide)</th><td>{health.queued} queued · {health.running} running · <span className={health.failed ? 'err' : ''}>{health.failed} failed{health.failed ? ' (needs attention)' : ''}</span></td></tr>
                <tr><th>Oldest queued job (instance-wide)</th><td>{health.oldestQueued ? ago(health.oldestQueued) : 'none waiting'}</td></tr>
                <tr><th>Dead tickets</th><td><span className={health.dead.length ? 'err' : ''}>{health.dead.length}</span>{health.dead.map((d) => <span key={d.id}> · <Link href={`/tickets/${d.id}`}>#{d.number}</Link> ({d.cause})</span>)}</td></tr>
                {health.sources.map((s) => (
                  <tr key={s.repo}>
                    <th>Last poll, {s.repo}</th>
                    <td>{s.polledAt ? ago(s.polledAt) : 'never'}{s.error && <span className="err"> · Failed: {s.error}</span>}</td>
                  </tr>
                ))}
                <tr><th>Gateway budget</th><td><span className={budget[1]}>{budget[0]}</span>{spend ? ` · $${spend.spentUsd.toFixed(2)}${spend.limitUsd == null ? '' : ` of $${spend.limitUsd}`}` : ''}</td></tr>
              </tbody>
            </table>
          </div>
          <h3 className="heading">Flaky checks</h3>
          {health.flakes.length ? (
            <div className="scroll">
              <table className="table">
                <thead><tr><th>Check</th><th>Passed after retry</th><th>Last seen</th><th>Ticket</th></tr></thead>
                <tbody>
                  {health.flakes.map((f) => (
                    <tr key={f.check}><td className="mono">{f.check}</td><td>{f.count}</td><td>{ago(f.lastSeen)}</td><td>{f.ticket ? `#${f.ticket}` : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">No check passed after a retry in the last 30 days.</p>
          )}
          </section>
        </>
      )}
    </>
  )
}
