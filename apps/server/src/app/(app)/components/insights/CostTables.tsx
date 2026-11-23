import Link from 'next/link'
import type { CostSummary } from '../../../../core/views/cost-view'
import { usd } from '../../lib/format'
import { COST_WORDS, span } from '../../lib/insights'
import { Table } from '../ui/table'

const NUM = 'mono text-right'

export function CostTable({ cost, outside }: { cost: CostSummary; outside: number | null }) {
  const { total } = cost
  const unmeasured = total.runs - total.measured
  return (
    <section aria-labelledby="cost" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 id="cost" className="label text-muted-foreground">Cost</h2>
      <Table aria-label="Cost by stage">
        <thead>
          <tr>
            <th scope="col">By stage</th>
            <th scope="col" className="text-right">Runs</th>
            <th scope="col" className="text-right">Measured</th>
            <th scope="col" className="text-right">Cost</th>
            <th scope="col" className="text-right">Per ticket</th>
          </tr>
        </thead>
        <tbody>
          {cost.rows.map((row) => (
            <tr key={row.key}>
              <td>{COST_WORDS[row.key]}</td>
              <td className={NUM}>{row.runs}</td>
              <td className={NUM}>{row.measured}</td>
              <td className={NUM}>{row.measured === 0 ? '—' : usd(row.costUsd)}</td>
              <td className={NUM}>{usd(row.perTicket)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="font-medium">Total</th>
            <td className={NUM}>{total.runs}</td>
            <td className={NUM}>{total.measured}</td>
            <td className={`${NUM} font-medium`}>{total.measured === 0 ? '—' : usd(total.costUsd)}</td>
            <td className={NUM}>{usd(total.medianPerTicket)}</td>
          </tr>
        </tbody>
      </Table>
      <p className="small text-muted-foreground">
        Measured: runs whose cost the gateway reported. The other {unmeasured} runs are left out of the sums, not
        counted as $0. Cost outside runs (a session idle, you working in the same session):{' '}
        <span className="mono">{outside === null ? 'not measured' : usd(outside)}</span>, all Products.
      </p>
    </section>
  )
}

export function TopTickets({ cost }: { cost: CostSummary }) {
  if (cost.top.length === 0) return null
  return (
    <section aria-labelledby="top" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 id="top" className="label text-muted-foreground">Most expensive tickets</h2>
      <Table aria-label="Most expensive tickets">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col" className="text-right">Verify rounds</th>
            <th scope="col" className="text-right">Lead time</th>
            <th scope="col" className="text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {cost.top.map((ticket) => (
            <tr key={ticket.recordId}>
              <td>
                <Link href={`/tickets/${ticket.recordId}`} className="text-primary hover:underline">
                  <span className="mono">#{ticket.number}</span> {ticket.title}
                </Link>
              </td>
              <td className={NUM}>{ticket.verifyRounds}</td>
              <td className={NUM}>{span(ticket.leadSeconds)}</td>
              <td className={NUM}>
                {usd(ticket.costUsd)}{' '}
                <span className="small text-muted-foreground">{ticket.measured} of {ticket.runs}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}

