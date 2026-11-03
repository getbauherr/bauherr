import Link from 'next/link'
import { Fragment } from 'react'
import { activity, ago, heartbeatAge } from '../lib/format'
import { GATES } from '../lib/gates'
import { BOARD_STAGES, type Need, stageLabel } from '../lib/needs-you'
import { DECISIONS_LOOKUPS, type RunRow, type TicketRow } from '../lib/overview'
import { isWebUrl } from '../lib/url'
import { frontierOrder } from '../../../lib/frontier'
import { SortableCards } from './SortableCards'
import { StatusChip } from './StatusChip'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { cn } from '@/lib/utils'

const Num = ({ t }: { t: TicketRow }) =>
  isWebUrl(t.url) ? <a className="mono text-primary" href={t.url}>#{t.number}</a> : <span className="mono">#{t.number}</span>

const Needs = ({ t }: { t: TicketRow }) =>
  t.needsYou ? (
    <span className="label text-warn" data-gate={t.gate ? '' : undefined}>
      {GATES[t.needsYou as Need].verb({ stage: t.run?.stage ?? '' })}
      {t.gateUnreachable && ' · no reachable owner'}
      {t.gate && ` · ${t.gate.people.map((p) => `@${p}`).join(' ')}${t.gate.people.length ? ' · ' : ''}waiting ${heartbeatAge(t.gate.since).text.replace(' ago', '')}`}
    </span>
  ) : t.stage === 'review' ? <span className="label text-muted-foreground">Factory reviewing</span> : null

const Working = ({ t }: { t: TicketRow }) => {
  const r = t.run
  if (!r || (r.status !== 'running' && r.status !== 'awaiting_session')) return null
  const at = r.heartbeatAt ?? r.startedAt
  const age = at ? heartbeatAge(at) : null
  const who = r.mode === 'session' ? (t.owner ?? 'session') : 'scheduler'
  return (
    <Link href={`/runs/${r.id}`} className={cn('label', age?.stale ? 'text-muted-foreground' : 'text-primary')}>
      {activity(t) ?? r.stage} · {who}{age && ` · ${age.text}`}
    </Link>
  )
}

const Blocked = ({ t }: { t: TicketRow }) =>
  t.blockedBy.length ? (
    <span className="label text-muted-foreground">
      Blocked by{' '}
      {t.blockedBy.map((b, i) => <Fragment key={b.id}>{i > 0 && ', '}<Link className="mono text-primary" href={`/tickets/${b.id}`}>#{b.number}</Link></Fragment>)}
    </span>
  ) : null

const Family = ({ t }: { t: TicketRow }) =>
  t.parent ? (
    <Link className="mono small text-primary" href={`/tickets/${t.parent.id}`}>↳ #{t.parent.number}</Link>
  ) : t.children.length ? (
    <details className="small">
      <summary>{t.children.filter((c) => !c.open).length}/{t.children.length} done</summary>
      <ul>{t.children.map((c) => <li key={c.id}><Link className="text-primary" href={`/tickets/${c.id}`}>#{c.number} {c.title}</Link>{!c.open && ' ✓'}</li>)}</ul>
    </details>
  ) : null

const title = (t: TicketRow) => <Link href={`/tickets/${t.id}`} className="ticket-title flex-1 hover:underline">{t.title}</Link>

export function BoardView({ tickets, capped, wip }: { tickets: TicketRow[]; capped: boolean; wip: Record<string, { count: number; limit: number | null }> }) {
  const latest = new Map(tickets.flatMap((t) => (t.run ? [[t.id, t.run] as const] : [])))
  return (
    <>
    {capped && <p className="small text-muted-foreground">Decisions checked for the first {DECISIONS_LOOKUPS} tickets</p>}
    <div className="board flex items-start gap-4 overflow-x-auto">
      {BOARD_STAGES.map((s) => {
        const rows = frontierOrder(tickets.filter((t) => t.stage === s).map((t) => ({ ...t, blocked: t.blockedBy.length > 0 })), latest)
        return (
          <Card key={s} asChild className="col flex-none basis-[260px] p-3">
          <section data-stage={s}>
              <h2 className="label">
                {s === 'parent' ? 'Split' : stageLabel(s)}{' '}
                {wip[s]?.limit != null ? <span className="font-semibold text-muted-foreground data-[state=full]:text-warn data-[state=over]:text-destructive" data-state={wip[s].count > wip[s].limit! ? 'over' : wip[s].count === wip[s].limit ? 'full' : undefined}>{wip[s].count} / {wip[s].limit}</span> : <span className="text-muted-foreground">{rows.length}</span>}
              </h2>
              <SortableCards
                items={rows.map((t) => ({
                  id: t.id,
                  movable: t.open,
                  running: activity(t) !== null,
                  node: (
                    <>
                      <Num t={t} />
                      {title(t)}
                      {t.product && <span className="small text-muted-foreground">{t.product.name}</span>}
                      {t.run && <StatusChip status={t.run.status} />}
                      <Working t={t} />
                      <Family t={t} />
                      <Blocked t={t} />
                      {t.waiting && <Badge variant="warn">{t.waiting}</Badge>}
                      <Needs t={t} />
                    </>
                  ),
                }))}
              />
            </section>
        </Card>
        )
      })}
    </div>
    </>
  )
}

export function RunsTable({ runs, tickets }: { runs: RunRow[]; tickets: Map<number, TicketRow> }) {
  return (
    <div className="scroll">
      <table className="table">
        <thead>
          <tr className="label">
            {['Ticket', 'Stage', 'Status', 'When'].map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const t = tickets.get(r.ticket)
            return (
              <tr key={r.id}>
                <td>{t ? <><Link href={`/runs/${r.id}`}>{t.title}</Link> <span className="mono muted">#{t.number}</span></> : <Link className="link" href={`/runs/${r.id}`}>Run</Link>}</td>
                <td>{r.stage}</td>
                <td><StatusChip status={r.status} /></td>
                <td title={r.createdAt}>{ago(r.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
