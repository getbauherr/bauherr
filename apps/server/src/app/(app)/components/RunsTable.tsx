import Link from 'next/link'
import { ago } from '../lib/format'
import type { RunRow, TicketRow } from '../lib/overview'
import { LinkPending } from './LinkPending'
import { StatusChip } from './StatusChip'
import { Table } from './ui/table'

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
              <td>{t ? <><Link href={`/runs/${r.id}`}>{t.title}<LinkPending /></Link> <span className="mono text-muted-foreground">#{t.number}</span></> : <Link className="text-primary" href={`/runs/${r.id}`}>Run</Link>}</td>
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
