import Link from 'next/link'
import { EmptyState } from '../../../components/EmptyState'
import { Field, PickField, SettingsForm } from '../../../components/SettingsForm'
import { Table } from '../../../components/ui/table'
import { shareOf } from '../../../../../lib/gateway'
import { workflowFor } from '../../../../../lib/factory'
import { modeStages } from '../../../../../lib/workflow'
import { isAdmin, listRepos, loadHealth, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { ago } from '../../../lib/format'
import { CAUSE_LABEL } from '../../../lib/needs-you'
import { KnowledgeRepo } from '../../../components/KnowledgeRepo'
import { createWorkspace, rotateWorkspaceKey, saveWorkspace } from '../actions'

export const dynamic = 'force-dynamic'

const split = (w: { budgetUnit: string; budgetUsd30d: number | null; budgetTokens30d: number | null; routerBudgetShare: number }) => {
  const tokens = w.budgetUnit === 'tokens'
  const base = (tokens ? w.budgetTokens30d : w.budgetUsd30d) ?? 0
  const fmt = (n: number) => (tokens ? `${n.toLocaleString('en')} tokens` : `$${n.toFixed(2)}`)
  return `${fmt(shareOf(base, tokens, 100 - w.routerBudgetShare))} direct / ${fmt(shareOf(base, tokens, w.routerBudgetShare))} auto`
}

const SECTION = 'flex flex-col gap-4'
const PAIR = 'grid grid-cols-2 gap-4 max-sm:grid-cols-1'
const TRIPLE = 'grid grid-cols-3 gap-4 max-sm:grid-cols-1'

const NewWorkspace = () => (
  <section id="new-workspace" className={SECTION}>
    <h2 className="heading">New Workspace</h2>
    <SettingsForm action={createWorkspace} submit="Create Workspace" reset>
      <div className={PAIR}>
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
  const repos = admin && w.knowledgeConnection ? await listRepos(Number(w.knowledgeConnection)) : null
  const health = admin ? await loadHealth(workspace.id) : null
  const spend = w.spend
  const budget = !admin ? ([] as string[]) : !w.gatewayOn ? ['Gateway off', 'text-muted-foreground'] : !spend ? ['Unavailable', 'text-muted-foreground'] : spend.limitUsd == null ? ['No limit', 'text-ok'] : spend.spentUsd >= spend.limitUsd ? ['Exhausted', 'text-destructive'] : spend.spentUsd >= 0.8 * spend.limitUsd ? ['Near limit', 'text-warn'] : ['OK', 'text-ok']
  return (
    <>
      <h2 className="heading">General</h2>
      {health && (
        <nav aria-label="On this page" className="small flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          {[['tiers', 'Model tiers'], ['run-mode', 'Run mode'], ['knowledge', 'Knowledge repo'], ['gateway', 'Gateway key'], ['health', 'Factory health']].map(([id, label]) => <a key={id} href={`#${id}`} className="hover:text-foreground">{label}</a>)}
        </nav>
      )}
      <SettingsForm action={saveWorkspace} submit="Save" primary bar>
        {admin && <Field name="name" label="Name" defaultValue={w.name} />}
        <div className={PAIR}>
          <Field name="budgetUnit" label="Budget unit" options={admin ? [['usd', 'USD'], ['tokens', 'Tokens']] : [['usd', 'USD']]} defaultValue={usd ? 'usd' : w.budgetUnit} />
          <Field name="budgetAmount" label="Budget per 30 days" type="number" min={0} step="any" defaultValue={usd ? w.budgetUsd30d ?? '' : w.budgetTokens30d ?? ''} />
        </div>
        {w.hasRouter && (
          <>
            <Field name="routerBudgetShare" label="Budget share for auto (%)" type="number" min={1} max={99} step={1} defaultValue={w.routerBudgetShare} />
            <p className="small text-muted-foreground">{split(w)}</p>
          </>
        )}
        {admin && <p className="small text-muted-foreground">{w.gatewayOn ? (w.spend ? `Spent in the last 30 days: $${w.spend.spentUsd.toFixed(2)}` : 'Spend unavailable.') : 'Gateway off: spend is not tracked.'}</p>}
        {admin && (
          <>
        <section id="tiers" className={SECTION}>
          <h2 className="heading">Model tiers{w.tiersRequired ? '' : ' (empty = preset default)'}</h2>
          <div className={TRIPLE}>
            {(['cheap', 'standard', 'strong'] as const).map((t) => (
              <PickField key={t} name={`tier_${t}`} label={t[0].toUpperCase() + t.slice(1)} options={w.modelChoices} empty={`Preset default (${w.placeholders[t]})`} defaultValue={w.modelByTier[t] ?? ''} placeholder={w.placeholders[t]} required={w.tiersRequired} />
            ))}
          </div>
        </section>
        <section id="run-mode" className={SECTION}>
          <h2 className="heading">Run mode</h2>
          <div className={TRIPLE}>
            <Field name="defaultMode" label="Default" options={['session', 'autonomous']} empty="inherit" defaultValue={w.defaultMode} />
            {modeStages(workflowFor(workspace.id)).map((t) => (
              <Field key={t} name={`mode_${t}`} label={`Stage ${t}`} options={['session', 'autonomous']} empty="default" defaultValue={w.modeByStage[t] ?? ''} />
            ))}
          </div>
        </section>
        <section id="knowledge" className={SECTION}>
          <h2 className="heading">Knowledge repo</h2>
          <div className={PAIR}>
            <KnowledgeRepo connections={w.githubConnections} connection={w.knowledgeConnection} repos={repos} repo={w.knowledgeRepo} />
          </div>
        </section>
          </>
        )}
      </SettingsForm>
      {admin && <NewWorkspace />}
      {health && (
        <>
          <section id="gateway" className={SECTION}>
            <h2 className="heading">Gateway key</h2>
            {!w.gatewayOn ? (
              <p className="small text-muted-foreground">Gateway off: there is no key to rotate.</p>
            ) : (
              <SettingsForm action={rotateWorkspaceKey} submit="Rotate key" confirm="Confirm rotate" inline>
                <p className="small text-muted-foreground">Issues a new consumer key at the gateway and invalidates the old one.</p>
              </SettingsForm>
            )}
          </section>
          <section id="health" className={SECTION}>
          <h2 className="heading">Factory health</h2>
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
                <tr><th>Expedite lead time (last 5)</th><td>{health.expediteLeadMs == null ? <span className="text-muted-foreground">No Hotfix merged yet.</span> : `${Math.max(1, Math.round(health.expediteLeadMs / 6e4))} min from flag to merge`}</td></tr>
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
          </section>
        </>
      )}
    </>
  )
}
