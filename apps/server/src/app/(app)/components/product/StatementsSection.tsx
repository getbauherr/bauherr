import { CHECK_AFTER, UNUSED_DAYS, type StatementRecord } from '../../../../core/views/statement-records'
import { SettingsSection } from '../SettingsParts'
import { Badge } from '../ui/badge'
import { Table } from '../ui/table'
import { RemoveStatement } from './RemoveStatement'

const PURPOSE =
  'What you told the factory, and how it fared: how often a Statement reached a Run, and how often the next ' +
  'Verify of that Ticket still found problems.'

type Props = { product: number; records: StatementRecord[]; admin: boolean }

function RecordTable({ records }: { records: StatementRecord[] }) {
  return (
    <Table aria-label="Statement records">
      <thead>
        <tr>
          <th scope="col">Statement</th>
          <th scope="col">Handed to a Run</th>
          <th scope="col">Came back</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.id}>
            <td>
              <span className="small text-muted-foreground">
                {record.kind}, #{record.ticket}
              </span>
              <p>{record.text}</p>
              {record.makeCheck && <Badge variant="warn">Make this a check</Badge>}
            </td>
            <td className="mono">{record.handed}</td>
            <td className="mono">{record.cameBack}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function Unused({ product, records, admin }: Props) {
  if (records.length === 0) return null
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Unused Statements">
      <h3 className="label">Not handed to a Run for {UNUSED_DAYS} days</h3>
      <ul className="flex flex-col gap-2">
        {records.map((record) => (
          <li key={record.id} className="flex items-center justify-between gap-4 border-t border-border pt-2">
            <span className="min-w-0">{record.text}</span>
            {admin && <RemoveStatement product={product} id={record.id} text={record.text} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StatementsSection({ product, records, admin }: Props) {
  return (
    <SettingsSection id="statements" title="Statements" purpose={PURPOSE}>
      {records.length === 0 ? (
        <p className="small text-muted-foreground">No Statements yet. Your answers and notes appear here.</p>
      ) : (
        <>
          <p className="small text-muted-foreground">
            A Statement that came back {CHECK_AFTER} times wants to become a check.
          </p>
          <RecordTable records={records} />
          <Unused product={product} records={records.filter((record) => record.unused)} admin={admin} />
        </>
      )}
    </SettingsSection>
  )
}
