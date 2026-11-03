import Link from 'next/link'
import { stageGroup } from '../../../lib/frontier'
import { layoutGraph } from '../lib/graph'
import { stageLabel } from '../lib/needs-you'
import type { TicketRow } from '../lib/overview'
import { activity } from '../lib/format'

const W = 220, H = 64, GX = 72, GY = 20, PAD = 4
const x = (col: number) => PAD + col * (W + GX)
const y = (row: number) => PAD + row * (H + GY)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Node({ t, n, x: nx, y: ny }: { t: TicketRow; n: { ready: boolean; critical: boolean }; x: number; y: number }) {
  const doing = activity(t)
  const label = `#${t.number} ${t.title}, stage ${stageLabel(t.stage)}${n.ready ? ', ready' : ''}${doing ? `, ${doing}` : ''}${t.blockedBy.length ? `, blocked by ${t.blockedBy.map((b) => `#${b.number}`).join(', ')}` : ''}`
  return (
    <Link href={`/tickets/${t.id}`} aria-label={label} className="gnode group cursor-pointer outline-none [--stage:var(--ink-muted)] data-[stage=plan]:[--stage:var(--warn)] data-[stage=build]:[--stage:var(--accent)] data-[stage=review]:[--stage:var(--accent-strong)] data-[stage=release]:[--stage:var(--warn)] data-[stage=done]:[--stage:var(--ok)]" data-stage={t.stage} data-ready={n.ready || undefined} data-critical={n.critical || undefined} data-running={doing ? '' : undefined} data-ticket={t.number}>
      <rect className="box fill-card stroke-border group-hover:stroke-primary group-data-[critical]:fill-accent group-data-[ready]:stroke-ok group-data-[ready]:[stroke-width:2] group-data-[running]:motion-safe:animate-march group-data-[running]:stroke-primary group-data-[running]:motion-safe:[stroke-dasharray:6_4] group-data-[running]:[stroke-width:2] group-focus-visible:stroke-ring group-focus-visible:[stroke-width:2]" x={nx} y={ny} width={W} height={H} rx={4} />
      <rect className="fill-(--stage)" x={nx} y={ny} width={4} height={H} />
      <text className="mono fill-foreground" x={nx + 14} y={ny + 20}>#{t.number}</text>
      <text className="label fill-muted-foreground" x={nx + W - 10} y={ny + 20} textAnchor="end">{t.stage}</text>
      <text className="fill-foreground text-[14px]" x={nx + 14} y={ny + 40}>{clip(t.title, 28)}</text>
      {doing && <text className="act label fill-primary" x={nx + 14} y={ny + 56}>{doing}</text>}
      {n.ready && <text className="ready label fill-ok" x={nx + 14} y={ny + 56}>ready</text>}
      {n.critical && <text className="label fill-primary" x={nx + W - 10} y={ny + 56} textAnchor="end">critical</text>}
    </Link>
  )
}

export function TicketGraph({ tickets }: { tickets: TicketRow[] }) {
  const { nodes, edges, cycle } = layoutGraph(tickets)
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const at = new Map(nodes.map((n) => [n.id, n]))
  const linked = nodes.filter((n) => !n.isolated)
  const isolated = nodes.filter((n) => n.isolated)
  const cols = Math.max(0, ...linked.map((n) => n.col)) + 1
  const rows = Math.max(0, ...linked.map((n) => n.row)) + 1
  return (
    <>
      {cycle && <p className="label text-destructive">Dependency cycle found; some blocked-by links are not drawn.</p>}
      <ul className="small m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-muted-foreground" aria-label="Legend">
        <li><span className="inline-block size-3 border-2 border-ok align-[-2px]" /> <span className="label text-ok">ready</span> no open blockers, not being worked on</li>
        <li><span className="inline-block h-[3px] w-3 bg-primary align-[3px]" /> <span className="label text-primary">critical path</span> longest chain of open blockers</li>
        <li>Left stripe: stage. Arrow: blocker to blocked.</li>
      </ul>
      {linked.length > 0 && (
        <div className="overflow-x-auto">
          <svg className="block max-w-none" role="group" aria-label="Ticket dependency graph" width={x(cols) - GX + PAD} height={y(rows) - GY + PAD}>
            <defs><marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path className="[fill:context-stroke]" d="M0 0L8 4L0 8z" /></marker></defs>
            {edges.map((e) => {
              const a = at.get(e.from)!, b = at.get(e.to)!
              const x1 = x(a.col) + W, y1 = y(a.row) + H / 2, x2 = x(b.col), y2 = y(b.row) + H / 2, dx = Math.max(GX, (x2 - x1) / 2)
              return <path key={`${e.from}-${e.to}`} className="gedge fill-none stroke-border [stroke-width:1.5] data-[critical]:stroke-primary data-[critical]:[stroke-width:2.5]" data-critical={e.critical || undefined} d={`M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`} markerEnd="url(#tg-arrow)" />
            })}
            {linked.map((n) => <Node key={n.id} t={byId.get(n.id)!} n={n} x={x(n.col)} y={y(n.row)} />)}
          </svg>
        </div>
      )}
      {isolated.length > 0 && (
        <section aria-labelledby="tg-iso">
          <h2 className="label" id="tg-iso">No dependencies ({isolated.length})</h2>
          {[...Array(6).keys()].map((g) => {
            const group = isolated.filter((n) => stageGroup(byId.get(n.id)!.stage) === g)
            if (!group.length) return null
            const list = (
              <ul className="mt-2 mb-4 flex list-none flex-wrap gap-3 p-0">
                {group.map((n) => <li key={n.id}><svg className="block max-w-none" role="group" aria-label={`Ticket #${byId.get(n.id)!.number}`} width={W + PAD * 2} height={H + PAD * 2}><Node t={byId.get(n.id)!} n={n} x={PAD} y={PAD} /></svg></li>)}
              </ul>
            )
            return g === 5 ? (
              <details key={g}><summary className="label">Show {group.length} more</summary>{list}</details>
            ) : (
              <section key={g} aria-labelledby={`tg-iso-${g}`}><h3 className="label" id={`tg-iso-${g}`}>{stageLabel(byId.get(group[0].id)!.stage)} ({group.length})</h3>{list}</section>
            )
          })}
        </section>
      )}
    </>
  )
}
