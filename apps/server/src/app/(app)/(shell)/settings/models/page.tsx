import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { Field, PickField, SettingsForm } from '../../../components/SettingsForm'
import { shareOf } from '../../../../../lib/gateway'
import { workflowFor } from '../../../../../lib/factory'
import { modeStages } from '../../../../../lib/workflow'
import { isAdmin, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { saveModels } from '../actions'

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

export default async function Models() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const w = await loadWorkspaceSettings(workspace.id)
  const usd = w.budgetUnit === 'usd'
  return (
    <>
      <h2 className="heading">Models &amp; budget</h2>
      <SettingsForm action={saveModels} submit="Save" primary bar>
        <section id="budget" className={SECTION}>
          <h3 className="heading">Budget</h3>
          <div className={PAIR}>
            <Field name="budgetUnit" label="Budget unit" options={[['usd', 'USD'], ['tokens', 'Tokens']]} defaultValue={usd ? 'usd' : w.budgetUnit} />
            <Field name="budgetAmount" label="Budget per 30 days" type="number" min={0} step="any" defaultValue={usd ? w.budgetUsd30d ?? '' : w.budgetTokens30d ?? ''} />
          </div>
          {w.hasRouter && (
            <>
              <Field name="routerBudgetShare" label="Budget share for auto (%)" type="number" min={1} max={99} step={1} defaultValue={w.routerBudgetShare} />
              <p className="small text-muted-foreground">{split(w)}</p>
            </>
          )}
          <p className="small text-muted-foreground">{w.gatewayOn ? (w.spend ? `Spent in the last 30 days: $${w.spend.spentUsd.toFixed(2)}` : 'Spend unavailable.') : 'Gateway off: spend is not tracked.'}</p>
        </section>
        <section id="tiers" className={SECTION}>
          <h3 className="heading">Model tiers{w.tiersRequired ? '' : ' (empty = preset default)'}</h3>
          <div className={TRIPLE}>
            {(['cheap', 'standard', 'strong'] as const).map((t) => (
              <PickField key={t} name={`tier_${t}`} label={t[0].toUpperCase() + t.slice(1)} options={w.modelChoices} empty={`Preset default (${w.placeholders[t]})`} defaultValue={w.modelByTier[t] ?? ''} placeholder={w.placeholders[t]} required={w.tiersRequired} />
            ))}
          </div>
        </section>
        <section id="run-mode" className={SECTION}>
          <h3 className="heading">Run mode</h3>
          <div className={TRIPLE}>
            <Field name="defaultMode" label="Default" options={['session', 'autonomous']} empty="inherit" defaultValue={w.defaultMode} />
            {modeStages(workflowFor(workspace.id)).map((t) => (
              <Field key={t} name={`mode_${t}`} label={`Stage ${t}`} options={['session', 'autonomous']} empty="default" defaultValue={w.modeByStage[t] ?? ''} />
            ))}
          </div>
        </section>
      </SettingsForm>
    </>
  )
}
