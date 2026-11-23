import Link from 'next/link'
import type { SessionRow } from '../../../../core/views/sessions'
import { EmptyState } from '../EmptyState'
import { Time } from '../Time'
import { Table } from '../ui/table'

function State({ row }: { row: SessionRow }) {
  if (row.state !== 'working') return row.state
  return (
    <>
      {row.tickets.length} of {row.capacity} working on{' '}
      {row.tickets.map((ticket, index) => (
        <span key={ticket.recordId}>
          {index > 0 && ', '}
          <Link href={`/tickets/${ticket.recordId}`} className="text-primary underline underline-offset-2">
            #{ticket.number}
          </Link>
        </span>
      ))}
    </>
  )
}

export function SessionsTable({ sessions }: { sessions: SessionRow[] }) {
  return (
    <section aria-labelledby="sessions" className="flex flex-col gap-4">
      <h2 id="sessions" className="heading">
        Sessions
      </h2>
      {sessions.length === 0 ? (
        <EmptyState text="No session has connected yet." />
      ) : (
        <Table>
          <thead>
            <tr className="label">
              <th>Role</th>
              <th>Label</th>
              <th>Key</th>
              <th>Connected</th>
              <th>Last seen</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((row) => (
              <tr key={row.id}>
                <td>{row.role}</td>
                <td>{row.label ?? '—'}</td>
                <td>{row.keyLabel}</td>
                <td>
                  <Time iso={row.connectedAt} />
                </td>
                <td>
                  <Time iso={row.lastSeenAt} />
                </td>
                <td>
                  <State row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}
