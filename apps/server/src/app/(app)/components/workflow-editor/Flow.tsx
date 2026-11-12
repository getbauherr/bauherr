'use client'
import { checkpointsOf, forwardKey, isCustom, stagesOf, takesRole, type Checkpoint, type Doc } from '../../../../lib/workflow-edit'
import { whenText } from '../../../../lib/workflow-when'
import { CHECKPOINT, humanize, pathLabel, plainFinding, STEP_TEXT, SPECIAL_TARGET, stageTitle } from '../../../../lib/workflow-labels'
import type { Kind } from '../../../../lib/workflow-rules'
import { cn } from '@/lib/utils'
import { CornerUpLeft, Ellipsis, Lock, Plus, User } from '../icons'
import { RoleAvatar } from '../team/RoleAvatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Switch } from '../ui/switch'
import { targetTitle, type RoleView } from './model'

export type FlowProps = {
  doc: Doc
  roles: RoleView[]
  counts: Record<string, number>
  findings: Map<string, string[]>
  selected: string | null
  onSelect: (name: string | null) => void
  highlightRole: string | null
  dragRole: string | null
  placing: RoleView | null
  slotOk: Record<string, boolean>
  moveOk: (name: string, dir: 1 | -1) => boolean
  onToggle: (which: 'plan' | 'staging' | 'production', on: boolean) => void
  onAdd: (after: string, kind: 'agent' | 'human') => void
  onSeat: (stage: string, role: string) => void
  onMove: (name: string, dir: 1 | -1) => void
  onRemove: (name: string) => void
}

export const AMBER = 'border-warn bg-[color-mix(in_srgb,var(--warn)_12%,var(--surface-100))]'
export const checkpointId = (c: Pick<Checkpoint, 'stage' | 'key'>) => `cp-${c.stage}-${c.key}`

const rowSwitch: Record<string, 'plan' | 'staging' | 'production'> = { plan: 'plan', staging: 'staging', production: 'production' }

/** The words of a path on a card: "then Build" or "↩ if changes are needed: back to Build". */
function Paths({ s, doc, order }: { s: Doc; doc: Doc; order: string[] }) {
  const rows = Object.entries((s.outcomes ?? {}) as Record<string, string>).filter(([, t]) => t !== s.name && !(t in SPECIAL_TARGET))
  const here = order.indexOf(s.name)
  const fwd = forwardKey(s)
  const forward = rows.find(([k]) => k === fwd)
  const back = rows.filter(([k, t]) => k !== fwd && order.indexOf(t) <= here)
  if (!forward && !back.length) return null
  return (
    <ul className="small m-0 flex list-none flex-col gap-0.5 p-0 text-muted-foreground">
      {forward && <li>then {targetTitle(doc, forward[1])}</li>}
      {back.map(([k, t]) => (
        <li key={k} className="flex items-center gap-1"><CornerUpLeft className="size-3.5 shrink-0" /> if {pathLabel(s.kind as Kind, k).toLowerCase()}: back to {targetTitle(doc, t)}</li>
      ))}
    </ul>
  )
}

function CheckpointRow({ c, doc, onToggle }: { c: Checkpoint; doc: Doc; onToggle: FlowProps['onToggle'] }) {
  const text = CHECKPOINT[c.key as keyof typeof CHECKPOINT]
  const switchKey = rowSwitch[c.key]
  return (
    <div id={checkpointId(c)} data-testid="checkpoint" data-on={c.on} className={cn('scroll-mt-24 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2', c.on ? AMBER : 'border-dashed border-border text-muted-foreground')}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <User className={cn('size-4 shrink-0', c.on && 'text-warn')} />
        {c.on ? <span className="min-w-0 font-medium text-foreground"><b className="text-warn">You</b> {text.row.replace(/^You /, '')}</span> : <span className="min-w-0">{text.off}</span>}
      </span>
      {c.always ? (
        <span className="small flex items-center gap-1 text-muted-foreground"><Lock className="size-3.5" /> always on</span>
      ) : (
        switchKey && <Switch aria-label={c.on ? `Stop asking me to ${text.row.replace(/^You /, '')}` : `Ask me: ${text.row.replace(/^You /, '')}`} checked={c.on} onChange={(e) => onToggle(switchKey, e.target.checked)} />
      )}
      {c.key === 'production' && c.on && <span className="small basis-full text-muted-foreground">A Product can also require this on its own.</span>}
      {c.key === 'production' && !c.on && <span className="small basis-full">A Product can still require this on its own.</span>}
      {c.key === 'refine' && <span className="small basis-full text-muted-foreground">The agent asks what is unclear before it plans.</span>}
    </div>
  )
}

function StageCard({ s, p, order, bad }: { s: Doc; p: FlowProps; order: string[]; bad: string[] }) {
  const { doc, roles } = p
  const kind = s.kind as Kind
  const role = roles.find((r) => r.id === s.role)
  const title = stageTitle(s)
  const selected = p.selected === s.name
  const human = kind === 'human'
  const takes = takesRole(kind)
  const dropOk = p.dragRole !== null && takes
  const n = p.counts[s.name] ?? 0
  const lit = !!p.highlightRole && s.role === p.highlightRole
  return (
    <div
      id={`step-${s.name}`}
      data-testid="step"
      data-stage={s.name}
      data-kind={kind}
      data-selected={selected}
      onClick={() => p.onSelect(s.name)}
      onDragOver={(e) => (p.dragRole || e.dataTransfer.types.includes('text/plain')) && e.preventDefault()} // not only the state: the first dragover can precede the re-render
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain') || p.dragRole
        if (id) p.onSeat(s.name, id)
      }}
      className={cn(
        'scroll-mt-24 flex cursor-pointer flex-col gap-2 rounded-md border bg-card p-3 transition-colors duration-(--duration-state)',
        human ? AMBER : kind === 'container' ? 'border-dashed border-border' : 'border-border',
        lit && 'bg-accent',
        selected && 'outline-2 -outline-offset-1 outline-primary',
        bad.length > 0 && 'outline-2 -outline-offset-1 outline-destructive',
        p.dragRole && (dropOk ? 'border-dashed border-primary' : 'opacity-60'),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {human && <span className="label flex items-center gap-1 text-warn"><User className="size-4" /> You</span>}
          <button type="button" className="border-0 bg-transparent p-0 text-left font-[inherit] font-semibold text-foreground" onClick={(e) => (e.stopPropagation(), p.onSelect(s.name))}>
            {human ? `Your decision: ${title}` : title}
          </button>
          <span className="small text-muted-foreground">{human ? STEP_TEXT.human : kind === 'agent' ? `Runs the ${s.skill} skill` : STEP_TEXT[kind]}</span>
        </div>
        {isCustom(s) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Menu of ${title}`} className="rounded-sm border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}><Ellipsis /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!p.moveOk(s.name, -1)} onSelect={() => p.onMove(s.name, -1)}>Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={!p.moveOk(s.name, 1)} onSelect={() => p.onMove(s.name, 1)}>Move down</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => p.onRemove(s.name)}>Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {takes && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="seat">
          {role ? <RoleAvatar avatar={role.avatar} size="sm" animate={false} /> : null}
          <span className="small font-medium text-foreground">{role?.title ?? 'No agent chosen'}</span>
          {role && <span className="small text-muted-foreground">{role.agents ? `up to ${role.agents} at once` : 'any number at once'}</span>}
        </div>
      )}
      {!takes && !human && kind !== 'done' && <span className="small text-muted-foreground">No agent: the factory does this itself</span>}
      {s.when && <span className="small self-start rounded-sm border border-primary px-2 py-0.5 text-primary" data-testid="when-chip">{whenText(s.when)}</span>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {typeof s.wip === 'number' && <span className="small rounded-sm border border-border px-2 py-0.5">at most {s.wip} tickets at a time</span>}
        {kind !== 'done' && kind !== 'container' && <span className="small text-muted-foreground">{n === 0 ? 'No tickets here now' : `${n} ${n === 1 ? 'ticket' : 'tickets'} here now`}</span>}
      </div>
      {human ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Your choices">
          {Object.entries((s.outcomes ?? {}) as Record<string, string>).map(([k, t]) => (
            <li key={k} className="small rounded-sm border border-warn bg-card px-2 py-1 font-medium">{humanize(k)} → {targetTitle(doc, t)}</li>
          ))}
        </ul>
      ) : (
        <Paths s={s} doc={doc} order={order} />
      )}
      {bad.map((f) => <p key={f} role="alert" className="small text-destructive">{plainFinding(f)}</p>)}
    </div>
  )
}

function Slot({ after, p, reason }: { after: Doc; p: FlowProps; reason: string }) {
  const ok = p.slotOk[after.name] === true
  const title = stageTitle(after)
  const cls = 'absolute left-0 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full border bg-background'
  return (
    <li className="relative flex min-h-9 items-center pl-9" data-testid="slot" data-after={after.name}>
      {!ok ? (
        <>
          <button type="button" disabled aria-label={`Add a step after ${title}`} className={cn(cls, 'cursor-not-allowed border-border text-muted-foreground opacity-60')}><Plus className="size-3.5" /></button>
          <span className="small text-muted-foreground">{reason}</span>
        </>
      ) : p.placing ? (
        <button type="button" aria-label={`Place ${p.placing.title} after ${title}`} className={cn(cls, 'border-primary bg-accent text-primary')} onClick={() => p.onAdd(after.name, 'agent')}><Plus className="size-3.5" /></button>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Add a step after ${title}`} className={cn(cls, 'border-border text-muted-foreground hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring')}><Plus className="size-3.5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => p.onAdd(after.name, 'agent')}>Add an agent step</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onAdd(after.name, 'human')}>Add a decision for you</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

/** The stages top to bottom as a path: cards, the places you are asked, and a "+" between two steps. */
export function Flow(p: FlowProps) {
  const stages = stagesOf(p.doc)
  const order = stages.map((s) => String(s.name))
  const cps = checkpointsOf(p.doc)
  return (
    <ol className="relative m-0 flex list-none flex-col p-0 before:absolute before:top-4 before:bottom-4 before:left-3 before:w-px before:bg-border" aria-label="Workflow steps">
      {stages.map((s) => {
        const mine = cps.filter((c) => c.stage === s.name && c.key !== 'human')
        return [
          <li key={s.name} className={cn('relative flex flex-col gap-2 pb-2 pl-9', s.kind === 'container' && 'pl-16')} data-side-track={s.kind === 'container' || undefined}>
            {/* A container stage is a side track of the plan step, not a step every ticket passes: indented, no dot on the path. */}
            {s.kind === 'container' ? <span className="small text-muted-foreground">Side track: only tickets that were split wait here</span> : <span className={cn('absolute top-4 left-[5px] size-[15px] rounded-full border-2 bg-background', s.kind === 'human' ? 'border-warn' : 'border-border')} aria-hidden />}
            <StageCard s={s} p={p} order={order} bad={p.findings.get(s.name) ?? []} />
            {mine.map((c) => <CheckpointRow key={c.key} c={c} doc={p.doc} onToggle={p.onToggle} />)}
          </li>,
          s.kind !== 'done' && s.kind !== 'container' ? <Slot key={`${s.name}+`} after={s} p={p} reason={`Steps cannot be added here: the factory fixes where ${stageTitle(s)} leads.`} /> : null,
        ]
      })}
    </ol>
  )
}

