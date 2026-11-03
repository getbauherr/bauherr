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

const Num = ({ t }: { t: TicketRow }) =>
  isWebUrl(t.url) ? <a className="mono link" href={t.url}>#{t.number}</a> : <span className="mono">#{t.number}</span>

const Needs = ({ t }: { t: TicketRow }) =>
  t.needsYou ? (
    <span className="label needs" data-gate={t.gate ? '' : undefined}>
      {GATES[t.needsYou as Need].verb({ stage: t.run?.stage ?? '' })}
      {t.gateUnreachable && ' · no reachable owner'}
      {t.gate && ` · ${t.gate.people.map((p) => `@${p}`).join(' ')}${t.gate.people.length ? ' · ' : ''}waiting ${heartbeatAge(t.gate.since).text.replace(' ago', '')}`}
    </span>
  ) : t.stage === 'review' ? <span className="label muted">Factory reviewing</span> : null

const Working = ({ t }: { t: TicketRow }) => {
  const r = t.run
  if (!r || (r.status !== 'running' && r.status !== 'awaiting_session')) return null
  const at = r.heartbeatAt ?? r.startedAt
  const age = at ? heartbeatAge(at) : null
  const who = r.mode === 'session' ? (t.owner ?? 'session') : 'scheduler'
  return (
    <Link href={`/runs/${r.id}`} className={`label ${age?.stale ? 'queued' : 'running'}`}>
      {activity(t) ?? r.stage} · {who}{age && ` · ${age.text}`}
    </Link>
  )
}

const Blocked = ({ t }: { t: TicketRow }) =>
  t.blockedBy.length ? (
    <span className="label queued">
      Blocked by{' '}
      {t.blockedBy.map((b, i) => <Fragment key={b.id}>{i > 0 && ', '}<Link className="mono link" href={`/tickets/${b.id}`}>#{b.number}</Link></Fragment>)}
    </span>
  ) : null

const Family = ({ t }: { t: TicketRow }) =>
  t.parent ? (
    <Link className="mono link small" href={`/tickets/${t.parent.id}`}>↳ #{t.parent.number}</Link>
  ) : t.children.length ? (
    <details className="small">
      <summary>{t.children.filter((c) => !c.open).length}/{t.children.length} done</summary>
      <ul>{t.children.map((c) => <li key={c.id}><Link className="link" href={`/tickets/${c.id}`}>#{c.number} {c.title}</Link>{!c.open && ' ✓'}</li>)}</ul>
    </details>
  ) : null

const title = (t: TicketRow) => <Link href={`/tickets/${t.id}`} className="grow ticket-title">{t.title}</Link>

export function BoardView({ tickets, capped }: { tickets: TicketRow[]; capped: boolean }) {
  const latest = new Map(tickets.flatMap((t) => (t.run ? [[t.id, t.run] as const] : [])))
  return (
    <>
    {capped && <p className="muted small">Decisions checked for the first {DECISIONS_LOOKUPS} tickets</p>}
    <div className="board">
      {BOARD_STAGES.map((s) => {
        const rows = frontierOrder(tickets.filter((t) => t.stage === s).map((t) => ({ ...t, blocked: t.blockedBy.length > 0 })), latest)
        return (
          <section key={s} className="col" data-stage={s}>
            <h2 className="label">{s === 'parent' ? 'Split' : stageLabel(s)} <span className="muted">{rows.length}</span></h2>
            <SortableCards
              items={rows.map((t) => ({
                id: t.id,
                movable: t.open,
                running: activity(t) !== null,
                node: (
                  <>
                    <Num t={t} />
                    {title(t)}
                    {t.product && <span className="muted small">{t.product.name}</span>}
                    {t.run && <StatusChip status={t.run.status} />}
                    <Working t={t} />
                    <Family t={t} />
                    <Blocked t={t} />
                    <Needs t={t} />
                  </>
                ),
              }))}
            />
          </section>
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
