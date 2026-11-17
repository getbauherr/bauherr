'use client'
import * as SelectPrimitive from '@radix-ui/react-select'
import { useState, type ElementType } from 'react'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Markdown } from '../Markdown'
import { SubmitButton } from '../SubmitButton'
import { renderMarkdown } from '../../lib/markdown'
import { Chip } from './Chip'
import { agentsLabel, groupOptions, modelName, modelValue, profileMarkdown } from './helpers'
import { RoleAvatar } from './RoleAvatar'
import type { ModelOption, RoleSettings, SaveResult, TeamRole } from './types'

const MAX_AGENTS = 10

export type SettingsProps = { modelOptions: ModelOption[]; canEdit: boolean; onSave: (roleId: string, settings: RoleSettings) => SaveResult | Promise<SaveResult> }

export function RoleSettingsForm({ role, modelOptions, canEdit, onSave }: SettingsProps & { role: TeamRole }) {
  const current = modelValue(role)
  const [model, setModel] = useState(current)
  const [limited, setLimited] = useState(role.agents !== undefined)
  const [agents, setAgents] = useState(role.agents ?? 1)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  const touch = () => {
    setSaved(false)
    setError(undefined)
  }
  const known = modelOptions.some((o) => o.value === model)
  const dirty = model !== current || (limited ? agents : undefined) !== role.agents
  return (
    <form
      className="flex flex-col gap-4"
      action={async () => {
        const r = await onSave(role.id, { model, agents: limited ? agents : undefined })
        setError(r?.error)
        setSaved(!r?.error)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="label text-muted-foreground" id={`model-${role.id}`}>Model</span>
          <Select value={model} onValueChange={(v) => { setModel(v); touch() }} disabled={!canEdit}>
            <SelectTrigger aria-labelledby={`model-${role.id}`}><SelectValue placeholder="Choose a model" /></SelectTrigger>
            <SelectContent>
              {model && !known && <SelectItem value={model}>{model}</SelectItem>}
              {groupOptions(modelOptions).map(([group, options]) => (
                <SelectPrimitive.Group key={group}>
                  <SelectPrimitive.Label className="label px-3 pt-2 pb-1 text-muted-foreground">{group === 'Tier' ? 'Tiers' : group}</SelectPrimitive.Label>
                  {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectPrimitive.Group>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label text-muted-foreground" id={`agents-${role.id}`}>Agents</span>
          <div className="flex h-9 items-center gap-2" role="group" aria-labelledby={`agents-${role.id}`}>
            <Button type="button" variant="outline" size="icon" aria-label="Fewer agents" disabled={!canEdit || !limited || agents <= 1} onClick={() => { setAgents(agents - 1); touch() }}>−</Button>
            <output className="mono w-8 text-center" aria-live="polite">{limited ? agents : '∞'}</output>
            <Button type="button" variant="outline" size="icon" aria-label="More agents" disabled={!canEdit || !limited || agents >= MAX_AGENTS} onClick={() => { setAgents(agents + 1); touch() }}>+</Button>
            <label className="small ml-2 flex items-center gap-2">
              <Checkbox checked={!limited} disabled={!canEdit} onChange={(e) => { setLimited(!e.target.checked); touch() }} />
              No limit
            </label>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="default" disabled={!canEdit || !model || !dirty}>Save</SubmitButton>
        {!canEdit && <span className="small text-muted-foreground">Only the owner can change a role.</span>}
        {saved && <span className="small text-ok" role="status">Saved</span>}
      </div>
      {error && <p className="small m-0 whitespace-pre-line text-destructive" role="alert">{error}</p>}
    </form>
  )
}

/** Avatar, title (`heading`), model, skills, profile and stages of a role. */
export function RoleBody({ role, heading: Heading = 'h2' }: { role: TeamRole; heading?: ElementType }) {
  return (
    <>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <RoleAvatar avatar={role.avatar} size="xl" animate />
        <div className="flex flex-col gap-2">
          <Heading className="title">{role.title}</Heading>
          <p className="small m-0 text-muted-foreground">{[modelName(role), agentsLabel(role.agents)].filter(Boolean).join(' · ')}</p>
          {role.skills.length > 0 && <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Skills">{role.skills.map((k) => <li key={k}><Chip muted>{k}</Chip></li>)}</ul>}
        </div>
      </div>
      <Markdown html={renderMarkdown(profileMarkdown(role.profile))} />
      <div className="flex flex-col gap-2">
        <span className="label text-muted-foreground">Works on</span>
        <div className="flex flex-wrap gap-2">
          {role.stages.length ? role.stages.map((s) => <Chip key={s.name} title={s.kind} className="capitalize">{s.title}</Chip>) : <span className="small text-muted-foreground">No stage</span>}
        </div>
        {role.exceptions && <p className="small m-0 text-muted-foreground">Handles stuck tickets.</p>}
      </div>
    </>
  )
}
