import Link from 'next/link'
import type { ReactNode } from 'react'
import { KIND_LABEL, KINDS } from '../../../../lib/intake/kinds'
import { Button } from '../../components/ui/button'
import { DiscardDraft } from '../../components/DiscardDraft'
import { EmptyState } from '../../components/EmptyState'
import { OrderedRequests, type OrderedItem } from '../../components/OrderedRequests'
import { ProgressPath } from '../../components/ProgressPath'
import { KindChip, LaneChip, NeedButton, StatusLine } from '../../components/RequestParts'
import { ReportProblem } from '../../components/ReportProblem'
import { Badge } from '../../components/ui/badge'
import { ago } from '../../lib/format'
import { loadDrafts, loadWorkbench, REQUESTS_LIMIT, type RequestRow } from '../../lib/requests'
import { currentPersonWorkspace } from '../../lib/session'
import { isProductOwner } from '../../../../lib/people'

export const dynamic = 'force-dynamic'

type Search = { product?: string; type?: string; mine?: string }

const Section = ({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) => (
  <details open={count > 0} className="group flex flex-col gap-3" data-testid={`section-${id}`} data-empty={count === 0 || undefined}>
    <summary className="heading flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden" id={id}>
      {title}<Badge variant={count ? 'accent' : 'muted'} data-testid={`count-${id}`}>{count}</Badge>
    </summary>
    {children}
  </details>
)

const Title = ({ row }: { row: RequestRow }) => (
  <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
    <div className="flex flex-wrap items-center gap-2">
      <Link className="body font-medium text-primary wrap-anywhere" href={row.href}>{row.title}</Link>
      <KindChip kind={row.kind} />
      <LaneChip urgent={row.urgent && row.lane === null} lane={row.lane} />
    </div>
    <span className="small text-muted-foreground">
      {row.ticket && <>{row.ticket.id ? <Link className="text-primary" href={`/tickets/${row.ticket.id}`}>#{row.ticket.number}</Link> : `#${row.ticket.number}`} · </>}
      {row.product}{row.by && <> · by {row.mine ? 'you' : row.by}</>} · {ago(row.updatedAt)}
    </span>
  </div>
)

export default async function Requests({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, workspace } = await currentPersonWorkspace()
  const owner = isProductOwner(user)
  const q = await searchParams
  const kind = KINDS.find((k) => k === q.type)
  const product = /^\d+$/.test(q.product ?? '') ? Number(q.product) : undefined
  const mine = q.mine === '1'
  const wb = workspace ? await loadWorkbench(workspace.id, user, { product, kind, mine }) : null
  const drafts = (workspace ? await loadDrafts(user, workspace.id) : []).filter((d) => (!product || d.productId === product) && (!kind || d.kind === kind))
  const href = (next: Search) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ product: q.product, type: q.type, mine: q.mine, ...next })) if (v) p.set(k, v)
    return p.size ? `/requests?${p}` : '/requests'
  }
  const chip = (label: string, active: boolean, to: string) => <Link key={label} href={to} aria-current={active ? 'page' : undefined}><Badge variant={active ? 'accent' : 'neutral'}>{label}</Badge></Link>
  const none = !wb || !(wb.needs.length || drafts.length || wb.factory.length || wb.done.length)
  return (
    <>
      <h1 className="title">Requests</h1>
      {wb && (
        <div className="flex flex-col gap-2" data-testid="request-filters">
          {wb.multiProduct && <nav aria-label="Product" className="flex flex-wrap gap-2">{[{ id: 0, name: 'All products' }, ...wb.products].map((p) => chip(p.name, (product ?? 0) === p.id, href({ product: p.id ? String(p.id) : undefined })))}</nav>}
          <nav aria-label="Type" className="flex flex-wrap gap-2">{[undefined, ...KINDS].map((k) => chip(k ? KIND_LABEL[k] : 'All types', kind === k, href({ type: k })))}</nav>
          {wb.showBy && <nav aria-label="Whose" className="flex flex-wrap gap-2">{chip('All requests', !mine, href({ mine: undefined }))}{chip('Mine', mine, href({ mine: '1' }))}</nav>}
        </div>
      )}
      {wb && (
        <>
          <Section id="needs" title="Needs you" count={wb.needs.length}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="needs">
              {wb.needs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-warn/50 bg-card p-3" data-testid="needs-row">
                  <Title row={r} />
                  <StatusLine status={r.status} waits={r.waits} />
                  {!owner && r.ticket?.id && r.need && <NeedButton ticket={r.ticket.id} need={r.need} />}
                </li>
              ))}
            </ul>
          </Section>
          <Section id="drafts" title="Drafts" count={drafts.length}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="drafts">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card p-3" data-testid="draft">
                  <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="body font-medium text-primary wrap-anywhere" href={`/requests/${d.id}`}>{d.title}</Link>
                      <KindChip kind={d.kind} />
                      <LaneChip urgent={d.urgent} />
                    </div>
                    <span className="small text-muted-foreground">{wb.multiProduct && <>{d.product} · </>}changed {ago(d.updatedAt)}</span>
                    <span className="small" data-testid="draft-ready">{d.canSend ? (d.missing.length ? `Can be sent · still open: ${d.missing.join(', ')}` : 'Ready to send') : `Missing: ${d.missing.join(', ')}`}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm"><Link href={`/requests/${d.id}`}>Continue</Link></Button>
                    <DiscardDraft session={d.id} title={d.title} label="Discard" />
                  </div>
                </li>
              ))}
            </ul>
          </Section>
          <Section id="factory" title="In the factory" count={wb.factory.length}>
            <OrderedRequests
              items={wb.factory.map((r): OrderedItem => ({
                session: r.id, ticket: r.ticket?.id ?? null, product: r.productId, movable: r.mine && !owner, title: r.title,
                node: (
                  <>
                    <Title row={r} />
                    <div className="flex flex-col gap-1" data-testid="request-progress">
                      <StatusLine status={r.status} waits={r.waits} />
                      {r.progress && <ProgressPath step={r.progress.step} />}
                    </div>
                  </>
                ),
              }))}
            />
          </Section>
          <Section id="done" title="Done" count={wb.done.length}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="done">
              {wb.done.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card p-3" data-testid="done-row">
                  <Title row={r} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="small" data-testid="request-status">{r.status}</span>
                    {r.note && <span className="small text-muted-foreground" data-testid="release-note">{r.note}</span>}
                  </div>
                  {!owner && !r.status.startsWith('Declined') && <ReportProblem session={r.id} size="sm" />}
                </li>
              ))}
            </ul>
          </Section>
          {wb.total > REQUESTS_LIMIT && <p className="text-muted-foreground small">Showing the newest {REQUESTS_LIMIT}</p>}
        </>
      )}
      {none && <EmptyState text={`No requests in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/requests/new', label: 'New request' }} />}
    </>
  )
}
