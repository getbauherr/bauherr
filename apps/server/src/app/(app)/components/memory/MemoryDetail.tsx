import Link from 'next/link'
import type { Fare, StatementRecord } from '../../../../core/views/statement-records'
import { stageSchema } from '../../../../core/events'
import { Badge } from '../ui/badge'
import { Table } from '../ui/table'
import { STAGE_NAMES } from '../../lib/factory'

export function Origin({ record, product }: { record: StatementRecord; product: string }) {
  return (
    <div className="grid gap-2">
      <h2 className="label m-0 text-muted-foreground">Where it came from</h2>
      <p className="m-0">
        {record.from}
        {record.ticket !== null && (
          <>
            {' on '}
            <Link href={`/tickets/${record.ticket.record}`} className="mono text-primary hover:underline">
              #{record.ticket.number}
            </Link>
          </>
        )}
        {` in ${product}.`}
        {record.learnRun !== null && (
          <>
            {' Written as a memory by Learn, '}
            <Link href={`/runs/${record.learnRun}`} className="mono text-primary hover:underline">
              run {record.learnRun}
            </Link>
            {'.'}
          </>
        )}
      </p>
      {record.sourceText !== null && (
        <p className="m-0 border-l-2 border-border pl-3 text-muted-foreground">{record.sourceText}</p>
      )}
      {record.originalText !== null && (
        <>
          <p className="small m-0 text-muted-foreground">Before your first edit:</p>
          <p className="m-0 border-l-2 border-border pl-3 text-muted-foreground">{record.originalText}</p>
        </>
      )}
    </div>
  )
}

const stageOf = (fare: Fare): string => {
  if (fare.stage === 'verify' && fare.role === 'reviewer') return 'Review'
  return STAGE_NAMES[stageSchema.parse(fare.stage)]
}

const OUTCOME = {
  'came-back': <Badge variant="warn">Came back</Badge>,
  clean: <Badge variant="ok">✓ Clean</Badge>,
  open: <span className="small text-muted-foreground">No verdict yet</span>,
} as const

export function Fared({ fares }: { fares: Fare[] }) {
  return (
    <div className="grid gap-2">
      <h2 className="label m-0 text-muted-foreground">How it fared</h2>
      {fares.length === 0 ? (
        <p className="m-0 text-muted-foreground">No run has got this memory yet.</p>
      ) : (
        <Table aria-label="Runs that got this memory">
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              <th scope="col">Run that got it</th>
              <th scope="col">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {fares.map((fare) => (
              <tr key={fare.run}>
                <td>
                  <Link href={`/tickets/${fare.ticket.record}`} className="mono text-primary hover:underline">
                    #{fare.ticket.number}
                  </Link>
                  {fare.ticket.title !== null && ` ${fare.ticket.title}`}
                </td>
                <td>
                  {stageOf(fare)},{' '}
                  <Link href={`/runs/${fare.run}`} className="mono text-primary hover:underline">
                    run {fare.run}
                  </Link>
                </td>
                <td>{OUTCOME[fare.outcome]}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
