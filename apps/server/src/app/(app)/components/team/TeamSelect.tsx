'use client'
import * as SelectPrimitive from '@radix-ui/react-select'
import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Markdown } from '../Markdown'
import { SubmitButton } from '../SubmitButton'
import { renderMarkdown } from '../../lib/markdown'
import { ConnectBlock } from './ConnectBlock'
import { Chip } from './Chip'
import { agentsLabel, connectPrompt, groupOptions, live, modelName, modelValue, profileMarkdown, tagline } from './helpers'
import { RoleAvatar } from './RoleAvatar'
import { sessionName, type GatewaySetup } from '../../lib/harnesses'
import type { ModelOption, RoleSettings, SaveResult, TeamRole } from './types'

const MAX_AGENTS = 10

type Props = {
  roles: TeamRole[]
  modelOptions: ModelOption[]
  canEdit: boolean
  onSave: (roleId: string, settings: RoleSettings) => SaveResult | Promise<SaveResult>
  docsHref: string
  /** The `claude mcp add` line with the factory URL and a key placeholder. */
  mcpLine: string
  /** Values for the per-tool setup that also routes the session through the gateway. */
  gateway?: GatewaySetup
  /** Read-only roster (setup wizard): no model/agents form and no connect block. */
  preview?: boolean
}

function Card({ role, chosen, hot, onPick, onHot }: { role: TeamRole; chosen: boolean; hot: boolean; onPick: () => void; onHot: (on: boolean) => void }) {
  const working = role.sessions.filter((s) => s.status === 'working').length
  const connected = live(role.sessions)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      tabIndex={chosen ? 0 : -1}
      data-role={role.id}
      onClick={onPick}
      onMouseEnter={() => onHot(true)}
      onMouseLeave={() => onHot(false)}
      onFocus={() => onHot(true)}
      onBlur={() => onHot(false)}
      className={cn(
        'flex w-64 shrink-0 cursor-pointer items-center gap-3 rounded-md border bg-card p-3 text-left outline-none transition-[transform,background-color,border-color] duration-(--duration-state) ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring lg:w-full',
        chosen ? '-translate-y-0.5 border-primary bg-accent ring-2 ring-primary' : 'border-border hover:bg-secondary',
      )}
    >
      <RoleAvatar avatar={role.avatar} size="lg" animate={chosen || hot} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="heading truncate">{role.title}</span>
        <span className="small line-clamp-2 text-muted-foreground">{tagline(role.profile)}</span>
        {role.skills.length > 0 && <span className="flex flex-wrap gap-1">{role.skills.slice(0, 3).map((k) => <Chip key={k} muted>{k}</Chip>)}</span>}
        <span className="small flex flex-wrap items-center gap-x-2 gap-y-1">
          {modelName(role) && <Chip>{modelName(role)}</Chip>}
          <span className="text-muted-foreground">{agentsLabel(role.agents)}</span>
          {connected > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className={cn('size-2 rounded-full', working ? 'bg-primary' : 'bg-muted-foreground')} aria-hidden />
              {working ? `${working} working` : `${connected} idle`}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function RoleSettingsForm({ role, modelOptions, canEdit, onSave }: Pick<Props, 'modelOptions' | 'canEdit' | 'onSave'> & { role: TeamRole }) {
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

export function TeamSelect({ roles, modelOptions, canEdit, onSave, docsHref, mcpLine, gateway, preview }: Props) {
  const [id, setId] = useState(roles[0]?.id)
  const [hot, setHot] = useState<string>()
  const group = useRef<HTMLDivElement>(null)
  const role = roles.find((r) => r.id === id)
  if (!role) return null

  const pick = (next: number) => {
    const to = roles[(next + roles.length) % roles.length]!
    setId(to.id)
    group.current?.querySelector<HTMLElement>(`[data-role="${to.id}"]`)?.focus()
  }
  const at = roles.indexOf(role)
  const onKey = (e: KeyboardEvent) => {
    const next = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: roles.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    pick(next)
  }
  const prompt = connectPrompt(role, gateway ? sessionName(role.id, gateway.roll) : undefined)

  return (
    <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <div ref={group} role="radiogroup" aria-label="Roles" onKeyDown={onKey} className="-mx-4 flex gap-3 overflow-x-auto px-4 py-1 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-1">
        {roles.map((r) => <Card key={r.id} role={r} chosen={r.id === id} hot={hot === r.id} onPick={() => setId(r.id)} onHot={(on) => setHot(on ? r.id : undefined)} />)}
      </div>
      <section aria-labelledby="role-title" className={cn('flex flex-col gap-6 rounded-md border border-border bg-card p-6', !preview && 'min-h-[40rem]')}>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <RoleAvatar avatar={role.avatar} size="xl" animate />
          <div className="flex flex-col gap-2">
            <h2 id="role-title" className="title">{role.title}</h2>
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
        {!preview && <RoleSettingsForm key={role.id} role={role} modelOptions={modelOptions} canEdit={canEdit} onSave={onSave} />}
        {!preview && <ConnectBlock mcpLine={mcpLine} prompt={prompt} docsHref={docsHref} gateway={gateway} role={role.id} />}
      </section>
    </div>
  )
}
