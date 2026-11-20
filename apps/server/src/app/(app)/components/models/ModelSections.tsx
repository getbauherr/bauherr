import type { loadWorkspaceSettings } from '../../lib/settings'
import { Field, PickField } from '../SettingsForm'

type Settings = Awaited<ReturnType<typeof loadWorkspaceSettings>>

const SECTION = 'flex flex-col gap-4'
const PAIR = 'grid grid-cols-2 gap-4 max-sm:grid-cols-1'
const TRIPLE = 'grid grid-cols-3 gap-4 max-sm:grid-cols-1'

export function BudgetSection({ w, usd }: { w: Settings; usd: boolean }) {
  return (
    <section id="budget" className={SECTION}>
      <h3 className="heading">Budget</h3>
      <div className={PAIR}>
        <Field
          name="budgetUnit"
          label="Budget unit"
          options={[
            ['usd', 'USD'],
            ['tokens', 'Tokens'],
          ]}
          defaultValue={usd ? 'usd' : w.budgetUnit}
        />
        <Field
          name="budgetAmount"
          label="Budget per 30 days"
          type="number"
          min={0}
          step="any"
          defaultValue={usd ? (w.budgetUsd30d ?? '') : (w.budgetTokens30d ?? '')}
        />
      </div>
      <p className="small text-muted-foreground">
        {w.gatewayOn
          ? w.spend
            ? `Spent in the last 30 days: $${w.spend.spentUsd.toFixed(2)}`
            : 'Spend unavailable.'
          : 'Gateway off: spend is not tracked.'}
      </p>
    </section>
  )
}

export function TiersSection({ w }: { w: Settings }) {
  return (
    <section id="tiers" className={SECTION}>
      <h3 className="heading">Model tiers{w.tiersRequired ? '' : ' (empty = preset default)'}</h3>
      <div className={TRIPLE}>
        {(['cheap', 'standard', 'strong'] as const).map((t) => (
          <PickField
            key={t}
            name={`tier_${t}`}
            label={t[0].toUpperCase() + t.slice(1)}
            options={w.modelChoices}
            empty={`Preset default (${w.placeholders[t]})`}
            defaultValue={w.modelByTier[t] ?? ''}
            placeholder={w.placeholders[t]}
            required={w.tiersRequired}
          />
        ))}
      </div>
    </section>
  )
}
