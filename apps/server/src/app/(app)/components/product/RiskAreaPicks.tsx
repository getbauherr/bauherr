'use client'
import { useId } from 'react'
import { useFieldError } from '../SettingsForm'
import { Checkbox } from '../ui/checkbox'

type Props = { sets: Record<string, string[]>; chosen: string[] }

const HINT = 'A change that touches a chosen path set always gets a Brief for you to approve.'

export function RiskAreaPicks({ sets, chosen }: Props) {
  const error = useFieldError('riskAreas')
  const uid = useId()
  const entries = Object.entries(sets).sort(([a], [b]) => a.localeCompare(b))
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={error ? `${uid}-e` : undefined}>
      <legend className="small p-0 font-medium text-foreground">Risk areas</legend>
      <span className="small text-muted-foreground">{HINT}</span>
      {entries.length === 0 && (
        <span className="small text-muted-foreground">Add a path set first, then choose it here.</span>
      )}
      {entries.map(([name, globs]) => (
        <label key={name} className="flex items-start gap-2">
          <Checkbox name="riskAreas" value={name} defaultChecked={chosen.includes(name)} className="mt-1" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="mono">{name}</span>
            <span className="small mono text-muted-foreground wrap-anywhere">
              {globs.join(' · ') || 'no paths yet'}
            </span>
          </span>
        </label>
      ))}
      {error && <span id={`${uid}-e`} role="alert" className="small text-destructive">{error}</span>}
    </fieldset>
  )
}
