import type { Executor } from '../../../../lib/executors'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { graph, title, type Workflow } from '../../../../lib/workflow'
import { duration } from '../../lib/format'
import type { NodeStats, StageAgents } from '../../lib/workflow-view'
import { RoleAvatar } from '../team/RoleAvatar'
import { layoutFlow, type Edge, type Layout, type Variant } from './layout'

export type FlowStats = { stages: Map<string, NodeStats>; checkpoints: Map<string, number>; agents?: Map<string, StageAgents>; executors?: Map<string, Executor> }
/** What one Ticket did: visits per stage, the current stage, and how often each transition `from>to` was taken. */
export type TicketPath = { visits: Map<string, number>; current: string; taken: Map<string, number> }

const BAR: Record<keyof NodeStats['bar'], { label: string; cls: string }> = {
  working: { label: 'in progress', cls: 'bg-primary' },
  human: { label: 'waiting for you', cls: 'bg-warn' },
  ci: { label: 'waiting for CI', cls: 'bg-foreground/45' },
  queued: { label: 'queued', cls: 'bg-muted-foreground/30' },
}
const TOP = { active: 'border-t-primary', attention: 'border-t-warn', idle: 'border-t-border' }

const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

const Flag = ({ className }: { className?: string }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5" /></svg>
)

function Executors({ execs }: { execs: NodeStats['execs'] }) {
  return (
    <ul className="m-0 flex list-none items-center gap-1 p-0" aria-label="Working here now" data-testid="stage-execs">
      {execs.slice(0, 3).map((e, i) => (
        <li key={i} className="relative flex size-5 items-center justify-center rounded-full border border-border bg-secondary text-[9px] font-semibold" title={e.tip} data-session={e.session || undefined}>
          {e.session ? initials(e.label) : 'R'}
          <span className="absolute -top-0.5 -right-0.5 size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        </li>
      ))}
      {execs.length > 3 && <li className="small text-muted-foreground">+{execs.length - 3}</li>}
    </ul>
  )
}

function StageCard({ id, name, stats, agent, executor, href, selected, terminals }: { id: string; name: string; stats: NodeStats; agent?: StageAgents; executor?: Executor; href: string; selected: boolean; terminals: { outcome: string; to: string }[] }) {
  const { bar } = stats
  const total = Math.max(1, bar.working + bar.human + bar.ci + bar.queued)
  const full = stats.limit != null && stats.count >= stats.limit
  const median = stats.medianSec != null ? `median ${duration(stats.medianSec)} in stage` : 'no data'
  // The compact card drops the median and the executors from view; the tooltip keeps them.
  const tip = [name, median, executor?.line, agent?.text && `${agent.role.title}: ${agent.text}`, ...stats.execs.map((e) => e.tip)].filter(Boolean).join('\n')
  return (
    <Link href={href} scroll={false} title={tip} aria-current={selected ? 'true' : undefined} data-testid="stage-node" data-stage={id} data-state={stats.state} className={cn('flex h-full flex-col gap-1.5 overflow-hidden rounded-md border border-border border-t-4 bg-card p-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring @min-[900px]:p-2 aria-[current]:bg-accent aria-[current]:ring-2 aria-[current]:ring-primary [&>*]:shrink-0', TOP[stats.state])}>
      <span className="truncate text-[11px] leading-4 font-semibold capitalize @min-[900px]:text-[13px]">{name}</span>
      <span className="mono flex items-baseline gap-1 text-[12px] @min-[900px]:text-[13px]">
        <span data-testid="stage-count" className={cn('font-semibold whitespace-nowrap', stats.limit != null && stats.count > stats.limit && 'text-destructive', full && 'text-warn')}>{stats.count}{stats.limit != null && ` / ${stats.limit}`}</span>
        {stats.limit == null && <span className="hidden text-[11px] text-muted-foreground @min-[900px]:inline">open</span>}
      </span>
      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
        {(Object.keys(BAR) as (keyof typeof BAR)[]).map((k) => bar[k] > 0 && <span key={k} className={BAR[k].cls} style={{ width: `${(bar[k] / total) * 100}%` }} />)}
      </span>
      <span className="mono flex min-h-4 flex-wrap gap-x-1.5 text-[10px] leading-4 @min-[900px]:gap-x-2 @min-[900px]:text-[11px]" data-testid="stage-bar">
        {(Object.keys(BAR) as (keyof typeof BAR)[]).map((k) => bar[k] > 0 && <span key={k} className="flex items-center gap-1" title={`${bar[k]} ${BAR[k].label}`}><i className={cn('inline-block size-2 rounded-[1px]', BAR[k].cls)} />{bar[k]}<span className="sr-only"> {BAR[k].label}</span></span>)}
      </span>
      <span className="hidden flex-col gap-1.5 @min-[900px]:flex">
        <span className="text-[10px] leading-4 tracking-tight whitespace-nowrap text-muted-foreground" data-testid="stage-median">{stats.medianSec != null ? `median ${duration(stats.medianSec)}` : 'no data'}</span>
        <Executors execs={stats.execs} />
        {executor && !agent && <span className={cn('block max-w-full truncate text-[10px] leading-3', executor.cannotRun ? 'font-semibold text-warn' : 'text-muted-foreground')} data-testid="stage-executor" data-cannot-run={executor.cannotRun || undefined} title={executor.line}>{executor.line}</span>}
        {agent && (
          <span className="flex flex-col items-start gap-1" data-testid="stage-agent" data-missing={agent.missing || undefined}>
            <RoleAvatar avatar={agent.role.avatar} size="sm" animate={agent.working + agent.runner + agent.ci > 0} />
            <span className={cn('text-[10px] leading-3', agent.missing ? 'font-semibold text-warn' : 'text-muted-foreground')}>{agent.text ?? agent.role.title}</span>
          </span>
        )}
      </span>
      {terminals.length > 0 && (
        <span className="mt-auto hidden flex-wrap gap-1 @min-[900px]:flex">
          {terminals.map((t) => <span key={t.outcome} className="rounded-full border border-dashed border-border px-1.5 text-[9px] leading-4 whitespace-nowrap text-muted-foreground" data-testid="stage-terminal">{t.outcome} → {t.to}</span>)}
        </span>
      )}
    </Link>
  )
}

function CheckpointCard({ id, name, count, href, selected }: { id: string; name: string; count: number; href: string; selected: boolean }) {
  return (
    <Link href={href} scroll={false} aria-current={selected ? 'true' : undefined} data-testid="checkpoint-node" data-checkpoint={id} data-waiting={count || undefined} className={cn('flex h-full flex-col items-center justify-center gap-0.5 rounded-[18px] border-2 border-dashed border-border bg-card px-1 text-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current]:ring-2 aria-[current]:ring-primary', count > 0 && 'border-solid border-warn')} title={`Human checkpoint: ${name}`}>
      <Flag className={cn('text-muted-foreground @min-[900px]:hidden', count > 0 && 'text-warn')} />
      <span className="sr-only @min-[900px]:hidden">{name}</span>
      <span className="hidden text-[8px] leading-[10px] font-semibold tracking-tight break-words text-muted-foreground uppercase @min-[900px]:block">{name}</span>
      <span className={cn('mono text-[13px] leading-4 font-semibold', count > 0 && 'text-warn')} data-testid="checkpoint-count">{count}<span className="sr-only text-[10px] font-normal @min-[900px]:not-sr-only @min-[900px]:inline"> {count === 1 ? 'waits' : 'wait'}</span></span>
    </Link>
  )
}

function PathCard({ name, visits, current, checkpoint }: { name: string; visits: number; current: boolean; checkpoint: boolean }) {
  return (
    <span title={name} data-testid="path-node" data-visited={visits > 0 || undefined} data-current={current || undefined} className={cn('flex h-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-border bg-card px-1 text-center opacity-55', checkpoint && 'rounded-[18px] border-dashed', visits > 0 && 'border-primary bg-accent opacity-100', current && 'ring-2 ring-primary opacity-100')}>
      {checkpoint ? <Flag className="text-muted-foreground" /> : <span className="max-w-full truncate text-[11px] leading-4 font-semibold capitalize">{name}</span>}
      <span className="mono text-[10px] leading-3 text-muted-foreground">{current ? 'now' : visits > 1 ? `${visits} rounds` : visits ? 'visited' : ''}</span>
    </span>
  )
}

const strong = (e: Edge, path?: TicketPath) => !!path && !e.dotted && (path.taken.get(`${e.from}>${e.to}`) ?? 0) > 0
const edgeColor = (e: Edge, path?: TicketPath) => (strong(e, path) ? 'text-primary' : path ? 'text-border' : 'text-muted-foreground')

/** Arrowhead as a CSS triangle at layout coordinates (x in percent of the width, y in pixels), so stretching the edge SVG never distorts it. */
function Arrow({ at, cls, W }: { at: NonNullable<Edge['end']>; cls: string; W: number }) {
  const shape = { down: 'border-x-[4px] border-t-[7px] border-x-transparent border-t-current -translate-x-1/2 -translate-y-full', up: 'border-x-[4px] border-b-[7px] border-x-transparent border-b-current -translate-x-1/2', right: 'border-y-[4px] border-l-[7px] border-y-transparent border-l-current -translate-x-full -translate-y-1/2' }[at.dir]
  return <i className={cn('pointer-events-none absolute size-0', shape, cls)} style={{ left: `${(at.x / W) * 100}%`, top: at.y }} />
}

/** The edge SVG (stretched, non-scaling strokes) and the HTML arrowheads and labels of one layout. `main` carries the test hooks; the other layout is the same drawing for narrower containers. */
function Edges({ L, variant, path, main, className }: { L: Layout; variant: Variant; path?: TicketPath; main: boolean; className: string }) {
  const font = variant === 'full' ? 11 : 10
  const pct = (x: number) => `${(x / L.width) * 100}%`
  return (
    <div className={cn('pointer-events-none absolute inset-0', className)} aria-hidden>
      <svg className="absolute top-0 left-0 w-full" height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} preserveAspectRatio="none">
        {L.edges.map((e) => (
          <g key={e.key} {...(main && { 'data-edge': `${e.from}>${e.to}`, 'data-outcome': e.outcome || undefined, 'data-back': e.back || undefined })} className={edgeColor(e, path)}>
            <path className={cn('fill-none stroke-current [stroke-width:1.5] [vector-effect:non-scaling-stroke]', strong(e, path) && '[stroke-width:2.5]', e.back && '[stroke-dasharray:5_4]', e.dotted && '[stroke-dasharray:2_3]')} d={e.d} />
          </g>
        ))}
      </svg>
      {L.edges.map((e) => (
        <span key={e.key}>
          {e.end && <Arrow at={e.end} cls={edgeColor(e, path)} W={L.width} />}
          {e.label && (
            <span className="absolute -translate-x-1/2 -translate-y-1/2 bg-background px-1 leading-none whitespace-nowrap text-muted-foreground" style={{ left: pct(e.label.x), top: e.label.y, fontSize: font }}>
              {e.outcome}{path && (path.taken.get(`${e.from}>${e.to}`) ?? 0) > 1 ? ` ×${path.taken.get(`${e.from}>${e.to}`)}` : ''}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

/**
 * The workflow as a graph: one card per stage, a pill per human checkpoint, outcome edges between them (backward ones dashed). Server-rendered from the node order and fluid:
 * nodes sit at percentages of the width, the edge SVG stretches with it (non-scaling strokes), arrowheads and labels are HTML at the same coordinates.
 * CSS container queries on the wrapper (the chat dock changes the width, not the viewport) pick one of two layouts computed for different natural widths: from 900 px full cards,
 * from 560 px compact cards (median and executors move into the tooltip, checkpoints shrink to a flag and a count), below it a column of the same cards with the transitions as text.
 * `full` carries live numbers per stage and links to `?stage=`; `path` is the compact variant of one Ticket's route.
 */
export function WorkflowGraph({ wf, variant, hrefOf, selected, stats, path }: { wf: Workflow; variant: Variant; hrefOf?: (id: string) => string; selected?: string; stats?: FlowStats; path?: TicketPath }) {
  const g = graph(wf)
  const L = layoutFlow(g, variant)
  const C = layoutFlow(g, variant === 'full' ? 'fullCompact' : 'pathCompact')
  const wide = new Map(L.nodes.map((n) => [n.id, n]))
  const narrow = new Map(C.nodes.map((n) => [n.id, n]))
  const pct = (x: number, W: number) => `${(x / W) * 100}%`
  return (
    <div className="@container w-full" data-testid={variant === 'full' ? 'workflow-graph' : 'ticket-path'} style={{ maxWidth: Math.round(L.width * 1.3) }}>
      <ol className="relative m-0 flex list-none flex-col gap-2 p-0 @min-[560px]:block @min-[560px]:[height:var(--hc)] @min-[900px]:[height:var(--h)]" style={{ '--h': `${L.height}px`, '--hc': `${C.height}px` } as CSSProperties} aria-label={variant === 'full' ? 'Workflow' : 'Path of this Ticket'}>
        <Edges L={L} variant={variant} path={path} main className="hidden @min-[900px]:block" />
        <Edges L={C} variant={variant} path={path} main={false} className="hidden @min-[560px]:block @min-[900px]:hidden" />
        {g.nodes.map((n) => {
          const p = wide.get(n.id)!
          const q = narrow.get(n.id)!
          const stage = n.id.includes(':') ? n.id.slice(0, n.id.indexOf(':')) : n.id
          const out = g.edges.filter((e) => e.from === n.id)
          return (
            <li key={n.id} className="@min-[560px]:absolute @min-[560px]:[height:var(--nhc)] @min-[560px]:[left:var(--xc)] @min-[560px]:[top:var(--yc)] @min-[560px]:[width:var(--nwc)] @min-[900px]:[height:var(--nh)] @min-[900px]:[left:var(--x)] @min-[900px]:[top:var(--y)] @min-[900px]:[width:var(--nw)]" style={{ '--x': pct(p.x, L.width), '--y': `${p.y}px`, '--nw': pct(p.w, L.width), '--nh': `${p.h}px`, '--xc': pct(q.x, C.width), '--yc': `${q.y}px`, '--nwc': pct(q.w, C.width), '--nhc': `${q.h}px` } as CSSProperties}>
              {variant === 'path' ? (
                <PathCard name={n.title} visits={path?.visits.get(n.id) ?? 0} current={path?.current === n.id} checkpoint={n.checkpoint} />
              ) : n.checkpoint ? (
                <CheckpointCard id={n.id} name={n.title} count={n.id.includes(':') ? (stats?.checkpoints.get(n.id) ?? 0) : (stats?.stages.get(n.id)?.count ?? 0)} href={hrefOf!(n.id)} selected={selected === n.id} />
              ) : (
                <StageCard id={n.id} name={n.title} stats={stats!.stages.get(stage)!} agent={stats!.agents?.get(stage)} executor={stats!.executors?.get(stage)} href={hrefOf!(n.id)} selected={selected === n.id} terminals={L.terminals.get(n.id)?.map((t) => ({ outcome: t.outcome, to: t.to })) ?? []} />
              )}
              {out.length > 0 && (
                <ul className="small m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-muted-foreground @min-[560px]:hidden" aria-label={`Transitions of ${n.title}`}>
                  {out.map((e) => <li key={`${e.outcome}>${e.to}`} className="capitalize">{e.outcome.replace(/_/g, ' ')} → {e.to === 'escalate' || e.to === 'backlog' ? e.to : title(wf, e.to)}{e.back && ' (back)'}</li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
