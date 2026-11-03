import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { ago } from '../../lib/format'
import { loadRequests, REQUESTS_LIMIT, type RequestRow } from '../../lib/requests'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

const TicketLink = ({ n, id, title }: { n: number; id?: number; title?: string }) =>
  id ? <Link className="link" href={`/tickets/${id}`}><span className="mono">#{n}</span>{title && ` ${title}`}</Link> : <span className="mono">#{n}</span>

function Linked({ t }: { t: NonNullable<RequestRow['ticket']> }) {
  return (
    <>
      <TicketLink n={t.number} id={t.id} title={t.title} />
      {t.stage && <span className="muted small"> · {t.stage}</span>}
      {t.children.map((c) => <div key={c.id} className="small"><span className="muted">↳ </span><TicketLink n={c.number} id={c.id} title={c.title} /></div>)}
    </>
  )
}

export default async function Requests() {
  const { workspace } = await currentWorkspace()
  const { rows, total } = workspace ? await loadRequests(workspace.id) : { rows: [], total: 0 }
  return (
    <>
      <h1 className="title">Requests</h1>
      {rows.length ? (
        <>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr className="label">{['Request', 'Product', 'Status', 'Tickets', 'Updated'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}</td>
                    <td>{r.product}</td>
                    <td><span className={`chip label ${r.linked ? 'succeeded' : 'queued'}`}>{r.linked ? 'Linked' : 'Draft'}</span></td>
                    <td>{r.ticket ? <Linked t={r.ticket} /> : <span className="muted">No Ticket yet</span>}</td>
                    <td className="mono">{ago(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > REQUESTS_LIMIT && <p className="muted small">Showing the newest {REQUESTS_LIMIT}</p>}
        </>
      ) : (
        <EmptyState text={`No requests in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/requests/new', label: 'New request' }} />
      )}
    </>
  )
}
