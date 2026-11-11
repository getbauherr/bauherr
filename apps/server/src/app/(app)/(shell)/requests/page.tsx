import Link from 'next/link'
import { RequestOpen } from '../../components/chat/DockOpen'
import { DiscardDraft } from '../../components/DiscardDraft'
import { ProgressPath } from '../../components/ProgressPath'
import { Badge } from '../../components/ui/badge'
import { Table } from '../../components/ui/table'
import { EmptyState } from '../../components/EmptyState'
import { ago } from '../../lib/format'
import { loadDrafts, loadRequests, REQUESTS_LIMIT } from '../../lib/requests'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Requests() {
  const { user, workspace } = await currentWorkspace()
  const { rows, total, multiProduct } = workspace ? await loadRequests(workspace.id, user.id as number) : { rows: [], total: 0, multiProduct: false }
  const drafts = workspace ? await loadDrafts(user.id as number, workspace.id) : []
  return (
    <>
      <h1 className="title">Requests</h1>
      {drafts.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="drafts">
          <h2 className="heading" id="drafts">Drafts</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="drafts">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card p-3" data-testid="draft">
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link className="body font-medium text-primary wrap-anywhere" href={`/requests/${d.id}`}>{d.title}</Link>
                  <span className="small text-muted-foreground">{multiProduct && <>{d.product} · </>}changed {ago(d.updatedAt)}</span>
                </div>
                <div className="flex gap-2">
                  <RequestOpen request={d.id} size="sm">Continue</RequestOpen>
                  <DiscardDraft session={d.id} title={d.title} label="Discard" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {rows.length ? (
        <>
          {drafts.length > 0 && <h2 className="heading">Sent</h2>}
          <Table>
              <thead>
                <tr className="label">{['Request', ...(multiProduct ? ['Product'] : []), 'Status', 'Progress'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.href ? <Link className="text-primary" href={r.href}>{r.title}</Link> : r.title}
                      {r.ticket && <> {r.ticket.id ? <Link className="text-primary" href={`/tickets/${r.ticket.id}`}>#{r.ticket.number}</Link> : <span>#{r.ticket.number}</span>}</>}
                    </td>
                    {multiProduct && <td>{r.product}</td>}
                    <td><Badge variant={r.linked ? 'ok' : 'neutral'}>{r.linked ? 'Sent' : 'Draft'}</Badge></td>
                    <td>
                      {r.progress ? (
                        <div className="flex flex-col gap-1" data-testid="request-progress">
                          <span>{r.progress.headline}{r.progress.since && <span className="small text-muted-foreground"> · since {ago(r.progress.since).replace(/ ago$/, '')}</span>}</span>
                          <ProgressPath step={r.progress.step} />
                        </div>
                      ) : <span className="text-muted-foreground">{ago(r.updatedAt)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          {total > REQUESTS_LIMIT && <p className="text-muted-foreground small">Showing the newest {REQUESTS_LIMIT}</p>}
        </>
      ) : drafts.length ? null : (
        <EmptyState text={`No requests in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/requests/new', label: 'New request' }} />
      )}
    </>
  )
}
