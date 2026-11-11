'use client'
import * as SelectPrimitive from '@radix-ui/react-select'
import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Markdown } from '../Markdown'
import { SubmitButton } from '../SubmitButton'
import { renderMarkdown } from '../../lib/markdown'
import { CopyButton } from './CopyButton'
import { defaultConnectPrompt, groupOptions, live, tagline } from './helpers'
import { RoleAvatar } from './RoleAvatar'
import type { ConnectPrompt, ModelOption, RoleSettings, TeamRole } from './types'

const MAX_AGENTS = 10

type Props = {
  roles: TeamRole[]
  modelOptions: ModelOption[]
  canEdit: boolean
  onSave: (roleId: string, settings: RoleSettings) => void | Promise<void>
  docsHref: string
  /** A function cannot cross from a server page: omit it there to get the default text. */
  connectPrompt?: ConnectPrompt
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
      <RoleAvatar avatar={role.avatar} size="md" animate={chosen || hot} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="heading truncate">{role.title}</span>
        <span className="small line-clamp-2 text-muted-foreground">{tagline(role.profile)}</span>
        <span className="small flex flex-wrap items-center gap-x-2 gap-y-1">
          {(role.model ?? role.tier) && <Badge className="max-w-full truncate normal-case tracking-normal">{role.model ?? role.tier}</Badge>}
          {role.agents ? <span className="text-muted-foreground">×{role.agents} agents</span> : null}
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
  const [model, setModel] = useState(role.model)
  const [limited, setLimited] = useState(role.agents !== undefined)
  const [agents, setAgents] = useState(role.agents ?? 1)
  const [saved, setSaved] = useState(false)
  const touch = () => setSaved(false)
  const known = modelOptions.some((o) => o.value === model)
  return (
    <form
      className="flex flex-col gap-4"
      action={async () => {
        await onSave(role.id, { model, agents: limited ? agents : undefined })
        setSaved(true)
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
        <SubmitButton variant="default" disabled={!canEdit || !model}>Save</SubmitButton>
        {!canEdit && <span className="small text-muted-foreground">Only the owner can change a role.</span>}
        {saved && <span className="small text-ok" role="status">Saved</span>}
      </div>
    </form>
  )
}

export function TeamSelect({ roles, modelOptions, canEdit, onSave, docsHref, connectPrompt = defaultConnectPrompt }: Props) {
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
  const prompt = connectPrompt(role)

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div ref={group} role="radiogroup" aria-label="Roles" onKeyDown={onKey} className="-mx-4 flex gap-3 overflow-x-auto px-4 py-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {roles.map((r) => <Card key={r.id} role={r} chosen={r.id === id} hot={hot === r.id} onPick={() => setId(r.id)} onHot={(on) => setHot(on ? r.id : undefined)} />)}
      </div>
      <section aria-labelledby="role-title" className="flex min-h-[40rem] flex-col gap-6 rounded-md border border-border bg-card p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <RoleAvatar avatar={role.avatar} size="xl" animate />
          <div className="flex flex-col gap-2">
            <h2 id="role-title" className="title">{role.title}</h2>
            <p className="small text-muted-foreground">{[role.tier, role.provider, role.model].filter(Boolean).join(' · ') || 'No model set'}</p>
          </div>
        </div>
        <Markdown html={renderMarkdown(role.profile)} />
        <div className="flex flex-col gap-2">
          <span className="label text-muted-foreground">Works on</span>
          <div className="flex flex-wrap gap-2">
            {role.stages.length ? role.stages.map((s) => <Badge key={s.name} title={s.kind}>{s.title}</Badge>) : <span className="small text-muted-foreground">No stage</span>}
          </div>
          {role.exceptions && <p className="small text-muted-foreground">Handles stuck tickets.</p>}
        </div>
        <RoleSettingsForm key={role.id} role={role} modelOptions={modelOptions} canEdit={canEdit} onSave={onSave} />
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="heading">Connect a session</h3>
          <pre className="mono m-0 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap">{prompt}</pre>
          <div className="flex items-center gap-3">
            <CopyButton text={prompt} />
            <a className="small text-primary" href={docsHref}>How sessions connect</a>
          </div>
        </div>
      </section>
    </div>
  )
}
