import { EmptyState } from '../../../components/EmptyState'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { isAdmin, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { rotateWorkspaceKey, saveWorkspace } from '../actions'

export const dynamic = 'force-dynamic'

export default async function WorkspaceSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const w = await loadWorkspaceSettings(workspace.id)
  const admin = isAdmin(user)
  const usd = w.budgetUnit === 'usd'
  return (
    <>
      <h2 className="heading">{w.name}</h2>
      {!admin && <p className="small muted">You can change the budget and model tiers. The rest is read-only.</p>}
      <SettingsForm action={saveWorkspace} primary>
        <Field name="name" label="Name" defaultValue={w.name} disabled={!admin} />
        <div className="pair">
          <Field name="budgetUnit" label="Budget unit" options={[['usd', 'USD'], ['tokens', 'Tokens']]} defaultValue={w.budgetUnit} />
          <Field name="budgetAmount" label="Budget per 30 days" type="number" min={0} step="any" defaultValue={usd ? w.budgetUsd30d ?? '' : w.budgetTokens30d ?? ''} />
        </div>
        <p className="small muted">{w.gatewayOn ? (w.spend ? `Spent in the last 30 days: $${w.spend.spentUsd.toFixed(2)}` : 'Spend unavailable.') : 'Gateway off: spend is not tracked.'}</p>
        <fieldset className="checks">
          <legend className="small muted">Model tiers{w.tiersRequired ? '' : ' (empty = preset default)'}</legend>
          <div className="pair three">
            {(['cheap', 'standard', 'strong'] as const).map((t) => (
              <Field key={t} name={`tier_${t}`} label={t[0].toUpperCase() + t.slice(1)} defaultValue={w.modelByTier[t] ?? ''} placeholder={w.placeholders[t]} required={w.tiersRequired} />
            ))}
          </div>
        </fieldset>
        <fieldset className="checks">
          <legend className="small muted">Run mode</legend>
          <div className="pair three">
            <Field name="defaultMode" label="Default" options={['session', 'autonomous']} empty="inherit" defaultValue={w.defaultMode} disabled={!admin} />
            {(['plan', 'build'] as const).map((t) => (
              <Field key={t} name={`mode_${t}`} label={`Stage ${t}`} options={['session', 'autonomous']} empty="default" defaultValue={w.modeByStage[t] ?? ''} disabled={!admin} />
            ))}
          </div>
        </fieldset>
      </SettingsForm>
      <h2 className="heading">Gateway key</h2>
      {!admin ? (
        <p className="small muted">Only an Admin can rotate the key.</p>
      ) : !w.gatewayOn ? (
        <p className="small muted">Gateway off: there is no key to rotate.</p>
      ) : (
        <SettingsForm action={rotateWorkspaceKey} submit="Rotate key" confirm="Confirm rotate" inline>
          <p className="small muted">Issues a new consumer key at the gateway and invalidates the old one.</p>
        </SettingsForm>
      )}
    </>
  )
}
