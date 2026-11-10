import Link from 'next/link'
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
          <div className="scroll">
            <table className="table">
              <thead>
                <tr className="label">{['Request', ...(multiProduct ? ['Product'] : []), 'Status', 'Updated'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.href ? <Link className="link" href={r.href}>{r.title}</Link> : r.title}
                      {r.ticket && <> {r.ticket.id ? <Link className="link" href={`/tickets/${r.ticket.id}`}>#{r.ticket.number}</Link> : <span>#{r.ticket.number}</span>}</>}
                    </td>
                    {multiProduct && <td>{r.product}</td>}
                    <td><span className={`chip label ${r.linked ? 'succeeded' : 'queued'}`}>{r.linked ? 'Sent' : 'Draft'}</span></td>
                    <td className="text-muted-foreground">{ago(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > REQUESTS_LIMIT && <p className="text-muted-foreground small">Showing the newest {REQUESTS_LIMIT}</p>}
        </>
      ) : (
        <EmptyState text={`No requests in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/requests/new', label: 'New request' }} />
      )}
    </>
  )
}
