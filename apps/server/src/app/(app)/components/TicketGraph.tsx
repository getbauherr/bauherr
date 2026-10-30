import Link from 'next/link'
import { layoutGraph } from '../lib/graph'
import { stageLabel } from '../lib/needs-you'
import type { TicketRow } from '../lib/overview'

const W = 220, H = 64, GX = 72, GY = 20, PAD = 4
const x = (col: number) => PAD + col * (W + GX)
const y = (row: number) => PAD + row * (H + GY)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Node({ t, n, x: nx, y: ny }: { t: TicketRow; n: { ready: boolean; critical: boolean }; x: number; y: number }) {
  const label = `#${t.number} ${t.title}, stage ${stageLabel(t.stage)}${n.ready ? ', ready' : ''}${t.blockedBy.length ? `, blocked by ${t.blockedBy.map((b) => `#${b.number}`).join(', ')}` : ''}`
  return (
    <Link href={`/tickets/${t.id}`} aria-label={label} className="gnode" data-stage={t.stage} data-ready={n.ready || undefined} data-critical={n.critical || undefined} data-ticket={t.number}>
      <rect className="box" x={nx} y={ny} width={W} height={H} rx={4} />
      <rect className="stripe" x={nx} y={ny} width={4} height={H} />
      <text className="mono num" x={nx + 14} y={ny + 20}>#{t.number}</text>
      <text className="label stage" x={nx + W - 10} y={ny + 20} textAnchor="end">{t.stage}</text>
      <text className="name" x={nx + 14} y={ny + 40}>{clip(t.title, 28)}</text>
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
      <ul className="legend small muted" aria-label="Legend">
        <li><span className="swatch ready" /> <span className="label ready">ready</span> no open blockers, not being worked on</li>
        <li><span className="swatch crit" /> <span className="label crit">critical path</span> longest chain of open blockers</li>
        <li>Left stripe: stage. Arrow: blocker to blocked.</li>
      </ul>
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
        <section aria-labelledby="tg-iso">
          <h2 className="label" id="tg-iso">No dependencies ({isolated.length})</h2>
          <div className="scroll">
            <svg className="tgraph" role="group" aria-label="Tickets without dependencies" width={PAD * 2 + isolated.length * (W + GY) - GY} height={H + PAD * 2}>
              {isolated.map((n, i) => <Node key={n.id} t={byId.get(n.id)!} n={n} x={PAD + i * (W + GY)} y={PAD} />)}
            </svg>
          </div>
        </section>
      )}
    </>
  )
}
