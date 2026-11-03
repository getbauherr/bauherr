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
    <Link href={`/tickets/${t.id}`} aria-label={label} className="gnode" data-stage={t.stage} data-ready={n.ready || undefined} data-critical={n.critical || undefined} data-running={doing ? '' : undefined} data-ticket={t.number}>
      <rect className="box" x={nx} y={ny} width={W} height={H} rx={4} />
      <rect className="stripe" x={nx} y={ny} width={4} height={H} />
      <text className="mono num" x={nx + 14} y={ny + 20}>#{t.number}</text>
      <text className="label stage" x={nx + W - 10} y={ny + 20} textAnchor="end">{t.stage}</text>
      <text className="name" x={nx + 14} y={ny + 40}>{clip(t.title, 28)}</text>
      {doing && <text className="label act" x={nx + 14} y={ny + 56}>{doing}</text>}
      {n.ready && <text className="label ready" x={nx + 14} y={ny + 56}>ready</text>}
      {n.critical && <text className="label crit" x={nx + W - 10} y={ny + 56} textAnchor="end">critical</text>}
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
      {cycle && <p className="label failed">Dependency cycle found; some blocked-by links are not drawn.</p>}
      <details className="legend-box">
      <summary className="label">Legend</summary>
      <ul className="legend small muted" aria-label="Legend">
        <li><span className="swatch ready" /> <span className="label ready">ready</span> no open blockers, not being worked on</li>
        <li><span className="swatch crit" /> <span className="label crit">critical path</span> longest chain of open blockers</li>
        <li>Left stripe: stage. Arrow: blocker to blocked.</li>
      </ul>
      </details>
      {linked.length > 0 && (
        <div className="scroll">
          <svg className="tgraph" role="group" aria-label="Ticket dependency graph" width={x(cols) - GX + PAD} height={y(rows) - GY + PAD}>
            <defs><marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L8 4L0 8z" /></marker></defs>
            {edges.map((e) => {
              const a = at.get(e.from)!, b = at.get(e.to)!
              const x1 = x(a.col) + W, y1 = y(a.row) + H / 2, x2 = x(b.col), y2 = y(b.row) + H / 2, dx = Math.max(GX, (x2 - x1) / 2)
              return <path key={`${e.from}-${e.to}`} className="gedge" data-critical={e.critical || undefined} d={`M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`} markerEnd="url(#tg-arrow)" />
            })}
            {linked.map((n) => <Node key={n.id} t={byId.get(n.id)!} n={n} x={x(n.col)} y={y(n.row)} />)}
          </svg>
        </div>
      )}
      {isolated.length > 0 && (
        <details>
        <summary className="label">No dependencies ({isolated.length})</summary>
        <section aria-label="No dependencies">
          {[...Array(6).keys()].map((g) => {
            const group = isolated.filter((n) => stageGroup(byId.get(n.id)!.stage) === g)
            if (!group.length) return null
            const list = (
              <ul className="gwrap">
                {group.map((n) => <li key={n.id}><svg className="tgraph" role="group" aria-label={`Ticket #${byId.get(n.id)!.number}`} width={W + PAD * 2} height={H + PAD * 2}><Node t={byId.get(n.id)!} n={n} x={PAD} y={PAD} /></svg></li>)}
              </ul>
            )
            return g === 5 ? (
              <details key={g}><summary className="label">Show {group.length} more</summary>{list}</details>
            ) : (
              <section key={g} aria-labelledby={`tg-iso-${g}`}><h3 className="label" id={`tg-iso-${g}`}>{stageLabel(byId.get(group[0].id)!.stage)} ({group.length})</h3>{list}</section>
            )
          })}
        </section>
        </details>
      )}
    </>
  )
}
