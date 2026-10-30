import Link from 'next/link'
import { Fragment } from 'react'
import { STAGES } from '../lib/needs-you'
import { DECISIONS_LOOKUPS, type RunRow, type TicketRow } from '../lib/overview'
import { isWebUrl } from '../lib/url'
import { StatusChip } from './StatusChip'

const Num = ({ t }: { t: TicketRow }) =>
  isWebUrl(t.url) ? <a className="mono link" href={t.url}>#{t.number}</a> : <span className="mono">#{t.number}</span>

const Needs = ({ t }: { t: TicketRow }) =>
  t.needsYou ? <span className="label needs">{t.needsYou}</span> : t.stage === 'review' ? <span className="label muted">Factory reviewing</span> : null

const Blocked = ({ t }: { t: TicketRow }) =>
  t.blockedBy.length ? (
    <span className="label queued">
      Blocked by{' '}
      {t.blockedBy.map((b, i) => <Fragment key={b.id}>{i > 0 && ', '}<Link className="mono link" href={`/tickets/${b.id}`}>#{b.number}</Link></Fragment>)}
    </span>
  ) : null

const title = (t: TicketRow) => <Link href={`/tickets/${t.id}`} className="grow ticket-title">{t.title}</Link>

export function BoardView({ tickets, capped }: { tickets: TicketRow[]; capped: boolean }) {
  return (
    <>
    {capped && <p className="muted small">Decisions checked for the first {DECISIONS_LOOKUPS} tickets</p>}
    <div className="board">
      {STAGES.map((s) => {
        const rows = tickets.filter((t) => t.stage === s)
        return (
          <section key={s} className="col" data-stage={s}>
            <h2 className="label">{s} <span className="muted">{rows.length}</span></h2>
            {rows.map((t) => (
              <article key={t.id} className="card">
                <Num t={t} />
                {title(t)}
                {t.product && <span className="muted small">{t.product.name}</span>}
                {t.run && <StatusChip status={t.run.status} />}
                <Blocked t={t} />
                <Needs t={t} />
              </article>
            ))}
          </section>
        )
      })}
    </div>
    </>
  )
}

const duration = (r: RunRow) => {
  if (!r.startedAt || !r.finishedAt) return '—'
  const s = Math.max(0, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export function RunsTable({ runs, tickets }: { runs: RunRow[]; tickets: Map<number, TicketRow> }) {
  return (
    <div className="scroll">
      <table className="table">
        <thead>
          <tr className="label">
            {['Run', 'Ticket', 'Stage', 'Status', 'Mode', 'Duration', 'Cost', 'Created'].map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const t = tickets.get(r.ticket)
            return (
              <tr key={r.id}>
                <td className="mono"><Link className="link" href={`/runs/${r.id}`}>#{r.id}</Link></td>
                <td>{t ? <><span className="mono">#{t.number}</span> <Link href={`/tickets/${t.id}`}>{t.title}</Link></> : '—'}</td>
                <td>{r.stage}</td>
                <td><StatusChip status={r.status} /></td>
                <td>{r.mode}</td>
                <td className="mono">{duration(r)}</td>
                <td className="mono">{r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '—'}</td>
                <td className="mono">{new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
