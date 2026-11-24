import Link from 'next/link'
import type { StatementRecord } from '../../../../core/views/statement-records'
import { Badge } from '../ui/badge'
import { Table } from '../ui/table'
import { TicketRef } from '../TicketRef'
import { CheckBadge, isShown } from './CheckState'

const COUNT = 'mono text-right'

const stateOf = (record: StatementRecord) => {
  if (record.off) return <Badge>Off</Badge>
  if (isShown(record.check)) return <CheckBadge check={record.check} />
  return record.isNew ? <Badge variant="accent">New</Badge> : <Badge variant="ok">Active</Badge>
}

export function MemoryTable({ records }: { records: StatementRecord[] }) {
  return (
    <Table aria-label="Memory">
      <thead>
        <tr>
          <th scope="col">Memory</th>
          <th scope="col">From</th>
          <th scope="col">Applies to</th>
          <th scope="col" className="text-right">Handed</th>
          <th scope="col" className="text-right">Came back</th>
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
            <td className={COUNT}>{record.cameBack}</td>
            <td>{stateOf(record)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
