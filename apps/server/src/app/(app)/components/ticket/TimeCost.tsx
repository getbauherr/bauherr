import type { ReactNode } from 'react'
import type { TicketView } from '../../../../core/views/ticket'
import { usd } from '../../lib/format'
import { span } from '../../lib/insights'
import { Facts } from './Section'

const LEAD = { done: 'Issue to done', closed: 'Issue to close', open: 'Open for' } as const

export function TimeCost({ timing }: { timing: TicketView['timing'] }) {
  const { time, cost } = timing
  const lead = LEAD[time.doneAt ? 'done' : time.closed ? 'closed' : 'open']
  const rows: [string, ReactNode][] = [
    [lead, <span key="lead" className="mono">{span(time.seconds)}</span>],
    ['Waiting on you', <span key="you" className="mono">{span(time.you)}</span>],
    ['Verify rounds', <span key="rounds" className="mono">{time.verifyRounds}</span>],
  ]
  if (time.sentBack > 0) rows.push(['Results sent back', <span key="back" className="mono">{time.sentBack}</span>])
  if (time.briefsChanged > 0) {
    rows.push(['Briefs changed', <span key="brief" className="mono">{time.briefsChanged}</span>])
  }
  rows.push([
    'Cost',
    <span key="cost">
      <span className="mono">{cost.costUsd === null ? 'not measured' : usd(cost.costUsd)}</span>{' '}
      <span className="small text-muted-foreground">{cost.measured} of {cost.runs} runs measured</span>
    </span>,
  ])
  return (
    <section className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h2 className="label m-0 text-muted-foreground">Time and cost</h2>
      <Facts rows={rows} />
    </section>
  )
}
