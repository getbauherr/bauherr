import Link from 'next/link'
import { type CSSProperties, Fragment } from 'react'
import { epicHue, epicShortTitle } from '../lib/epics'
import { activity, heartbeatAge } from '../lib/format'
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

const EpicTag = ({ t }: { t: TicketRow }) =>
  t.parent ? (
    <Link className="epic-tag small" style={{ '--hue': epicHue(t.parent.id) } as CSSProperties} href={`/tickets/${t.parent.id}`} title={`Epic #${t.parent.number} ${t.parent.title}`}>{epicShortTitle(t.parent.title)}</Link>
  ) : null

const title = (t: TicketRow) => <Link href={`/tickets/${t.id}`} className="grow ticket-title">{t.title}</Link>

export function BoardView({ tickets, capped, wip }: { tickets: TicketRow[]; capped: boolean; wip: Record<string, { count: number; limit: number | null }> }) {
  const latest = new Map(tickets.flatMap((t) => (t.run ? [[t.id, t.run] as const] : [])))
  return (
    <>
    {capped && <p className="muted small">Decisions checked for the first {DECISIONS_LOOKUPS} tickets</p>}
    <div className="board">
      {BOARD_STAGES.map((s) => {
        const rows = frontierOrder(tickets.filter((t) => t.stage === s).map((t) => ({ ...t, blocked: t.blockedBy.length > 0 })), latest)
        return (
          <section key={s} className="col" data-stage={s}>
            <h2 className="label">
              {stageLabel(s)}{' '}
              {wip[s]?.limit != null ? <span className="wip" data-state={wip[s].count > wip[s].limit! ? 'over' : wip[s].count === wip[s].limit ? 'full' : undefined}>{wip[s].count} / {wip[s].limit}</span> : <span className="muted">{rows.length}</span>}
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
                    {t.product && <span className="muted small">{t.product.name}</span>}
                    {t.run && <StatusChip status={t.run.status} />}
                    <Working t={t} />
                    <EpicTag t={t} />
                    <Blocked t={t} />
                    {t.waiting && <span className="label chip waiting">{t.waiting}</span>}
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
