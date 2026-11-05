import Link from 'next/link'
import type { CSSProperties } from 'react'
import { epicHue, epicShortTitle } from '../lib/epics'
import { cardStatus, showsProduct } from '../lib/card-status'
import { activity, ago, heartbeatAge } from '../lib/format'
import { GATES } from '../lib/gates'
import { BOARD_STAGES, type Need, stageLabel } from '../lib/needs-you'
import type { RunRow, TicketRow } from '../lib/overview'
import { frontierOrder } from '../../../lib/frontier'
import { SortableCards } from './SortableCards'
import { StatusChip } from './StatusChip'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Table } from './ui/table'

const Num = ({ t }: { t: TicketRow }) => <span className="num mono small text-muted-foreground">#{t.number}</span>

const gateTip = (t: TicketRow) =>
  [t.gateUnreachable && 'no reachable owner', t.gate && `${t.gate.people.map((p) => `@${p}`).join(' ')}${t.gate.people.length ? ' · ' : ''}waiting ${heartbeatAge(t.gate.since).text.replace(' ago', '')}`].filter(Boolean).join(' · ') || undefined

const Needs = ({ t }: { t: TicketRow }) => (
  <span className="label text-warn" data-gate={t.gate ? '' : undefined} title={gateTip(t)}>{GATES[t.needsYou as Need].verb({ stage: t.run?.stage ?? '' })}</span>
)

const Status = ({ s }: { s: NonNullable<ReturnType<typeof cardStatus>> }) => (
  <Badge variant={['Working', 'Investigating'].includes(s.status) ? 'accent' : 'muted'} data-status={s.status.toLowerCase()} title={s.tip} aria-label={s.status === 'Working' ? undefined : `${s.status}: ${s.tip}`}>{s.status}</Badge>
)

const EpicTag = ({ t }: { t: TicketRow }) =>
  t.parent ? (
    <Link className="epic-tag small inline-block max-w-full truncate rounded-sm border border-(--tint)/40 bg-[color-mix(in_oklch,var(--tint)_14%,var(--card))] px-2 text-[color-mix(in_oklch,var(--tint)_65%,var(--foreground))] hover:underline" style={{ '--tint': `oklch(60% .16 ${epicHue(t.parent.id)})` } as CSSProperties} href={`/tickets/${t.parent.id}`} title={`Epic #${t.parent.number} ${t.parent.title}`}>{epicShortTitle(t.parent.title)}</Link>
  ) : null

const title = (t: TicketRow) => <Link href={`/tickets/${t.id}`} className="ticket-title flex-1 hover:underline">{t.title}</Link>

export function BoardView({ tickets, showProduct, admin, wip }: { tickets: TicketRow[]; showProduct: boolean; admin: boolean; wip: Record<string, { count: number; limit: number | null }> }) {
  const latest = new Map(tickets.flatMap((t) => (t.run ? [[t.id, t.run] as const] : [])))
  return (
    <>
    <div className="board flex items-start gap-4 overflow-x-auto">
      {BOARD_STAGES.map((s) => {
        const rows = frontierOrder(tickets.filter((t) => t.stage === s).map((t) => ({ ...t, blocked: t.blockedBy.length > 0, expediting: t.expedite })), latest)
        return (
          <Card key={s} asChild className="col flex-none basis-[260px] p-3">
          <section data-stage={s}>
              <h2 className="label">
                {stageLabel(s)}{' '}
                {wip[s]?.limit != null ? (admin ? <Link href="/settings/workflow#wip" className="hover:underline"><span className="font-semibold text-muted-foreground data-[state=full]:text-warn data-[state=over]:text-destructive" data-state={wip[s].count > wip[s].limit! ? 'over' : wip[s].count === wip[s].limit ? 'full' : undefined}>{wip[s].count} / {wip[s].limit}</span></Link> : <span className="font-semibold text-muted-foreground data-[state=full]:text-warn data-[state=over]:text-destructive" data-state={wip[s].count > wip[s].limit! ? 'over' : wip[s].count === wip[s].limit ? 'full' : undefined}>{wip[s].count} / {wip[s].limit}</span>) : <span className="text-muted-foreground">{rows.length}</span>}
              </h2>
              <SortableCards
                items={rows.map((t) => {
                  const st = t.needsYou ? null : cardStatus(t, admin)
                  return {
                    id: t.id,
                    movable: t.open,
                    running: activity(t) !== null,
                    hotfix: t.expedite,
                    node: (
                      <>
                        {title(t)}
                        {t.expedite && <span className="label text-destructive" data-hotfix>Hotfix</span>}
                        {t.needsYou ? <Needs t={t} /> : st && <Status s={st} />}
                        <EpicTag t={t} />
                        {t.product && showsProduct(t, st !== null, showProduct) && <span className="small text-muted-foreground">{t.product.name}</span>}
                        <Num t={t} />
                      </>
                    ),
                  }
                })}
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
    <Table>
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
              <td>{t ? <><Link href={`/runs/${r.id}`}>{t.title}</Link> <span className="mono text-muted-foreground">#{t.number}</span></> : <Link className="text-primary" href={`/runs/${r.id}`}>Run</Link>}</td>
              <td>{r.stage}</td>
              <td><StatusChip status={r.status} /></td>
              <td title={r.createdAt}>{ago(r.createdAt)}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
