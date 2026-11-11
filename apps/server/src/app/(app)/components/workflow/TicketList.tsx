import Link from 'next/link'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { executionOrder } from '../../../../lib/frontier'
import { title as stageTitle, type Workflow } from '../../../../lib/workflow'
import { epicHue, epicShortTitle } from '../../lib/epics'
import { duration, heartbeatAge } from '../../lib/format'
import type { TicketRow } from '../../lib/overview'
import { ticketStatus } from '../../lib/status'
import { LinkPending } from '../LinkPending'
import { TicketStatus } from '../TicketStatus'
import { SortableRows } from './SortableRows'

const gateTip = (t: TicketRow) =>
  [t.gateUnreachable && 'no reachable owner', t.gate && `${t.gate.people.map((p) => `@${p}`).join(' ')}${t.gate.people.length ? ' · ' : ''}waiting ${heartbeatAge(t.gate.since).text.replace(' ago', '')}`].filter(Boolean).join(' · ') || undefined

const EpicTag = ({ t }: { t: TicketRow }) =>
  t.parent ? (
    <Link className="epic-tag small inline-block max-w-full truncate rounded-sm border border-(--tint)/40 bg-[color-mix(in_oklch,var(--tint)_14%,var(--card))] px-2 text-[color-mix(in_oklch,var(--tint)_65%,var(--foreground))] hover:underline" style={{ '--tint': `oklch(60% .16 ${epicHue(t.parent.id)})` } as CSSProperties} href={`/tickets/${t.parent.id}`} title={`Epic #${t.parent.number} ${t.parent.title}`}>{epicShortTitle(t.parent.title)}</Link>
  ) : null

export type Group = { stage: string; rows: TicketRow[] }

/** The Tickets of the Workflow view, one ranked table per stage in workflow order. */
/** `collapsed`: the stage whose rows hide behind a "Show N done" link to `expandHref`; `sticky`: headings stay under the shell header while their group is on screen. */
export function TicketList({ wf, groups, showProduct, admin, wip, now, collapsed, expandHref, sticky }: { wf: Workflow; groups: Group[]; showProduct: boolean; admin: boolean; wip: Record<string, { count: number; limit: number | null }>; now: number; collapsed?: string; expandHref?: string; sticky?: boolean }) {
  return (
    <div className="@container flex flex-col gap-6" data-testid="ticket-list">
      {groups.map(({ stage, rows }, g) => {
        // The list shows the owner's rank, not the pull order: a row never jumps because it is blocked or in progress (the status says so). Only the Hotfix lane sorts first.
        const sorted = rows.map((t) => ({ ...t, expediting: t.expedite })).sort(executionOrder)
        const limit = wip[stage]?.limit
        const state = limit != null && wip[stage]!.count > limit ? 'over' : limit != null && wip[stage]!.count === limit ? 'full' : undefined
        const count = limit != null ? <span className="font-semibold text-muted-foreground data-[state=full]:text-warn data-[state=over]:text-destructive" data-state={state}>{wip[stage]!.count} / {limit}</span> : <span className="text-muted-foreground">{rows.length}</span>
        return (
          <section key={stage} data-stage={stage} className="col flex flex-col gap-2" aria-label={stageTitle(wf, stage)}>
            <h2 className={cn('m-0 flex items-baseline gap-2 py-1 text-[13px] font-semibold capitalize', sticky && 'sticky top-0 z-10 bg-background')} data-testid="group-heading">{stageTitle(wf, stage)} {limit != null && admin ? <Link href="/workflow/edit" className="hover:underline">{count}</Link> : count}</h2>
            {stage === collapsed ? (
              <Link href={expandHref!} scroll={false} className="small rounded-md border border-border bg-card px-3 py-2 text-primary hover:bg-accent" data-testid="show-done-group">Show {rows.length} done</Link>
            ) : (
            <SortableRows
              head={g === 0}
              items={sorted.map((t) => {
                const s = ticketStatus(wf, t, now)
                return {
                  id: t.id,
                  movable: t.open,
                  running: s.phase === 'working',
                  hotfix: t.expedite,
                  cells: [
                    <span key="n" className="num mono small text-muted-foreground">#{t.number}</span>,
                    <span key="t" className="flex flex-col items-start gap-1">
                      <Link href={`/tickets/${t.id}`} className="ticket-title hover:underline">{t.title}<LinkPending /></Link>
                      <span className="flex flex-wrap items-center gap-2">
                        {t.expedite && <span className="label text-destructive" data-hotfix>Hotfix</span>}
                        <EpicTag t={t} />
                        {t.product && showProduct && <span className="small text-muted-foreground @min-[800px]:hidden">{t.product.name}</span>}
                      </span>
                    </span>,
                    <span key="p" className="small text-muted-foreground">{t.product?.name ?? '—'}</span>,
                    <span key="s" className="flex flex-col gap-0.5" data-gate={t.gate ? '' : undefined}>
                      <TicketStatus s={s} who="narrow" title={t.needsYou ? gateTip(t) : undefined} href={s.phase === 'human' && t.open ? `/inbox#t${t.id}` : undefined} />
                      {t.releasedIn && <span className="label text-muted-foreground" data-released>Released in {t.releasedIn}</span>}
                    </span>,
                    <span key="w" className="small text-muted-foreground" data-testid="row-who">{s.who ?? '—'}</span>,
                    <span key="a" className="small text-muted-foreground" title={t.enteredAt} data-testid="row-age">{t.open ? duration((now - +new Date(t.enteredAt)) / 1000) : '—'}</span>,
                  ],
                }
              })}
            />
            )}
          </section>
        )
      })}
    </div>
  )
}
