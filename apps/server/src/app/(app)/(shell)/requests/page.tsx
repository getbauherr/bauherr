import Link from 'next/link'
import { ProgressPath } from '../../components/ProgressPath'
import { Badge } from '../../components/ui/badge'
import { Table } from '../../components/ui/table'
import { EmptyState } from '../../components/EmptyState'
import { ago } from '../../lib/format'
import { loadRequests, REQUESTS_LIMIT } from '../../lib/requests'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Requests() {
  const { user, workspace } = await currentWorkspace()
  const { rows, total, multiProduct } = workspace ? await loadRequests(workspace.id, user.id as number) : { rows: [], total: 0, multiProduct: false }
  return (
    <>
      <h1 className="title">Requests</h1>
      {rows.length ? (
        <>
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
      ) : (
        <EmptyState text={`No requests in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/requests/new', label: 'New request' }} />
      )}
    </>
  )
}
