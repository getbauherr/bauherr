import Link from 'next/link'
import type { StatementRecord } from '../../../../core/views/statement-records'
import { Table } from '../ui/table'
import { TicketRef } from '../TicketRef'
import { MemoryState } from './MemoryState'

const COUNT = 'mono text-right'

export function MemoryTable({ records }: { records: StatementRecord[] }) {
  return (
    <Table aria-label="Memory">
      <thead>
        <tr>
          <th scope="col">Memory</th>
          <th scope="col">From</th>
          <th scope="col">Applies to</th>
          <th scope="col" className="text-right">Handed</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.id}>
            <td>
              <Link href={`/memory/${record.id}`} className={record.off ? 'text-muted-foreground' : 'text-primary'}>
                {record.text}
              </Link>
            </td>
            <td>
              {record.from}
              {record.ticket !== null && (
                <>
                  {', '}
                  <TicketRef recordId={record.ticket.record} number={record.ticket.number} />
                </>
              )}
            </td>
            <td>{record.reachLabel}</td>
            <td className={COUNT}>{record.handed}</td>
            <td><MemoryState off={record.off} /></td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
