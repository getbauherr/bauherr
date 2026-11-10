import Link from 'next/link'
import { cn } from '@/lib/utils'
import { graph, title, type Workflow } from '../../../../lib/workflow'
import { duration } from '../../lib/format'
import type { NodeStats } from '../../lib/workflow-view'
import { layoutFlow, type Edge, type Placed, type Variant } from './layout'

export type FlowStats = { stages: Map<string, NodeStats>; checkpoints: Map<string, number> }
/** What one Ticket did: visits per stage, the current stage, and how often each transition `from>to` was taken. */
export type TicketPath = { visits: Map<string, number>; current: string; taken: Map<string, number> }

const BAR: Record<keyof NodeStats['bar'], { label: string; cls: string }> = {
  working: { label: 'in progress', cls: 'bg-primary' },
  human: { label: 'waiting for you', cls: 'bg-warn' },
  ci: { label: 'waiting on CI', cls: 'bg-foreground/45' },
  queued: { label: 'queued', cls: 'bg-muted-foreground/30' },
}
const TOP = { active: 'border-t-primary', attention: 'border-t-warn', idle: 'border-t-border' }

const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

function Executors({ execs }: { execs: NodeStats['execs'] }) {
  return (
    <ul className="m-0 flex min-h-[22px] list-none flex-wrap items-center gap-1 p-0" aria-label="Working here now" data-testid="stage-execs">
      {execs.slice(0, 4).map((e, i) => (
        <li key={i} className="relative flex size-[22px] items-center justify-center rounded-full border border-border bg-secondary text-[10px] font-semibold" title={e.tip} data-session={e.session || undefined}>
          {e.session ? initials(e.label) : 'R'}
          <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full border border-card bg-primary motion-reduce:animate-none" />
        </li>
      ))}
      {execs.length > 4 && <li className="small text-muted-foreground">+{execs.length - 4}</li>}
    </ul>
  )
}

function StageCard({ id, name, stats, href, selected, terminals }: { id: string; name: string; stats: NodeStats; href: string; selected: boolean; terminals: { outcome: string; to: string }[] }) {
  const { bar } = stats
  const total = Math.max(1, bar.working + bar.human + bar.ci + bar.queued)
  const full = stats.limit != null && stats.count >= stats.limit
  return (
    <Link href={href} scroll={false} aria-current={selected ? 'true' : undefined} data-testid="stage-node" data-stage={id} data-state={stats.state} className={cn('flex h-full flex-col gap-1.5 overflow-hidden rounded-md border border-border border-t-4 [&>*]:shrink-0 bg-card p-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:ring-2 aria-[current]:ring-primary', TOP[stats.state])}>
      <span className="truncate text-[13px] leading-4 font-semibold">{name}</span>
      <span className="mono flex items-baseline gap-1 text-[13px]">
        <span data-testid="stage-count" className={cn('font-semibold', stats.limit != null && stats.count > stats.limit && 'text-destructive', full && 'text-warn')}>{stats.count}{stats.limit != null && ` / ${stats.limit}`}</span>
        <span className="text-[11px] text-muted-foreground">{stats.limit != null ? 'WIP' : 'open'}</span>
      </span>
      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
        {(Object.keys(BAR) as (keyof typeof BAR)[]).map((k) => bar[k] > 0 && <span key={k} className={BAR[k].cls} style={{ width: `${(bar[k] / total) * 100}%` }} />)}
      </span>
      <span className="mono flex min-h-4 flex-wrap gap-x-2 text-[11px] leading-4" data-testid="stage-bar">
        {(Object.keys(BAR) as (keyof typeof BAR)[]).map((k) => bar[k] > 0 && <span key={k} className="flex items-center gap-1" title={`${bar[k]} ${BAR[k].label}`}><i className={cn('inline-block size-2 rounded-[1px]', BAR[k].cls)} />{bar[k]}<span className="sr-only"> {BAR[k].label}</span></span>)}
      </span>
      <span className="small text-[11px] leading-4 text-muted-foreground" data-testid="stage-median">{stats.medianSec != null ? `median ${duration(stats.medianSec)}` : 'no history yet'}</span>
      <Executors execs={stats.execs} />
      {terminals.length > 0 && (
        <span className="mt-auto flex flex-wrap gap-1">
          {terminals.map((t) => <span key={t.outcome} className="rounded-full border border-dashed border-border px-1.5 text-[10px] leading-4 text-muted-foreground" data-testid="stage-terminal">{t.outcome} → {t.to}</span>)}
        </span>
      )}
    </Link>
  )
}

function CheckpointCard({ id, name, count, href, selected }: { id: string; name: string; count: number; href: string; selected: boolean }) {
  return (
    <Link href={href} scroll={false} aria-current={selected ? 'true' : undefined} data-testid="checkpoint-node" data-checkpoint={id} data-waiting={count || undefined} className={cn('flex h-full flex-col items-center justify-center gap-0.5 rounded-[22px] border-2 border-dashed border-border bg-card px-2 text-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current]:ring-2 aria-[current]:ring-primary', count > 0 && 'border-solid border-warn')} title={`Human checkpoint: ${name}`}>
      <span className="label text-[10px] leading-3 text-muted-foreground">{name}</span>
      <span className={cn('mono text-[13px] leading-4 font-semibold', count > 0 && 'text-warn')} data-testid="checkpoint-count">{count}<span className="text-[11px] font-normal"> {count === 1 ? 'waits' : 'wait'}</span></span>
    </Link>
  )
}

function PathCard({ name, visits, current, checkpoint }: { name: string; visits: number; current: boolean; checkpoint: boolean }) {
  return (
    <span data-testid="path-node" data-visited={visits > 0 || undefined} data-current={current || undefined} className={cn('flex h-full flex-col justify-center gap-0.5 rounded-md border border-border bg-card px-2 text-center opacity-55', checkpoint && 'rounded-[18px] border-dashed', visits > 0 && 'border-primary bg-accent opacity-100', current && 'ring-2 ring-primary opacity-100')}>
      <span className="truncate text-[11px] leading-4 font-semibold">{name}</span>
      <span className="mono text-[10px] leading-3 text-muted-foreground">{current ? 'now' : visits > 1 ? `${visits} rounds` : visits ? 'visited' : ''}</span>
    </span>
  )
}

const edgeClass = (e: Edge, path?: TicketPath) => {
  const taken = path && !e.dotted && (path.taken.get(`${e.from}>${e.to}`) ?? 0) > 0
  return cn('fill-none [stroke-width:1.5]', taken ? 'stroke-primary [stroke-width:2.5]' : path ? 'stroke-border' : 'stroke-muted-foreground', e.back && '[stroke-dasharray:5_4]', e.dotted && '[stroke-dasharray:2_3]')
}

/**
 * The workflow as a graph: one card per stage, a pill per human checkpoint, outcome edges between them (backward ones dashed). Server-rendered from the node order; below `md` it is a column of the same cards with the transitions as text.
 * `full` carries live numbers per stage and links to `?stage=`; `path` is the compact variant of one Ticket's route.
 */
export function WorkflowGraph({ wf, variant, hrefOf, selected, stats, path }: { wf: Workflow; variant: Variant; hrefOf?: (id: string) => string; selected?: string; stats?: FlowStats; path?: TicketPath }) {
  const g = graph(wf)
  const L = layoutFlow(g, variant)
  const byId = new Map(L.nodes.map((n): [string, Placed] => [n.id, n]))
  const font = variant === 'full' ? 11 : 10
  return (
    <div className="md:overflow-x-auto" data-testid={variant === 'full' ? 'workflow-graph' : 'ticket-path'}>
      <ol className="relative m-0 flex list-none flex-col gap-2 p-0 md:block md:[height:var(--h)] md:[width:var(--w)]" style={{ '--w': `${L.width}px`, '--h': `${L.height}px` } as React.CSSProperties} aria-label={variant === 'full' ? 'Workflow' : 'Path of this Ticket'}>
        <svg className="pointer-events-none absolute inset-0 hidden md:block" width={L.width} height={L.height} aria-hidden>
          <defs>
            <marker id={`arrow-${variant}`} viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path className="[fill:context-stroke]" d="M0 0L8 4L0 8z" /></marker>
          </defs>
          {L.edges.map((e) => (
            <g key={e.key} data-edge={`${e.from}>${e.to}`} data-outcome={e.outcome || undefined} data-back={e.back || undefined}>
              <path className={edgeClass(e, path)} d={e.d} markerEnd={e.dotted ? undefined : `url(#arrow-${variant})`} />
              {e.label && (
                <text className="fill-muted-foreground stroke-background [paint-order:stroke] [stroke-linejoin:round] [stroke-width:4px]" x={e.label.x} y={e.label.y} textAnchor="middle" fontSize={font}>
                  {e.outcome}{path && (path.taken.get(`${e.from}>${e.to}`) ?? 0) > 1 ? ` ×${path.taken.get(`${e.from}>${e.to}`)}` : ''}
                </text>
              )}
            </g>
          ))}
        </svg>
        {g.nodes.map((n) => {
          const p = byId.get(n.id)!
          const stage = n.id.includes(':') ? n.id.slice(0, n.id.indexOf(':')) : n.id
          const out = g.edges.filter((e) => e.from === n.id)
          return (
            <li key={n.id} className="md:absolute md:[height:var(--nh)] md:[left:var(--x)] md:[top:var(--y)] md:[width:var(--nw)]" style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--nw': `${p.w}px`, '--nh': `${p.h}px` } as React.CSSProperties}>
              {variant === 'path' ? (
                <PathCard name={n.title} visits={path?.visits.get(n.id) ?? 0} current={path?.current === n.id} checkpoint={n.checkpoint} />
              ) : n.checkpoint ? (
                <CheckpointCard id={n.id} name={n.title} count={n.id.includes(':') ? (stats?.checkpoints.get(n.id) ?? 0) : (stats?.stages.get(n.id)?.count ?? 0)} href={hrefOf!(n.id)} selected={selected === n.id} />
              ) : (
                <StageCard id={n.id} name={n.title} stats={stats!.stages.get(stage)!} href={hrefOf!(n.id)} selected={selected === n.id} terminals={L.terminals.get(n.id)?.map((t) => ({ outcome: t.outcome, to: t.to })) ?? []} />
              )}
              {out.length > 0 && (
                <ul className="small m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-muted-foreground md:hidden" aria-label={`Transitions of ${n.title}`}>
                  {out.map((e) => <li key={`${e.outcome}>${e.to}`}>{e.outcome} → {e.to === 'escalate' || e.to === 'backlog' ? e.to : title(wf, e.to)}{e.back && ' (back)'}</li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
