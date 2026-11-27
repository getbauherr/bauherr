import type { InsightsView } from '../../../../core/views/insights-page'
import { usd } from '../../lib/format'
import { percent, rounds, span } from '../../lib/insights'

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="small order-2 text-muted-foreground">{label}</dt>
      <dd className="order-1 m-0 text-2xl font-semibold leading-[30px] tabular-nums">{value}</dd>
    </div>
  )
}

export function SummaryRow({ view }: { view: InsightsView }) {
  const { time, cost } = view
  return (
    <dl className="m-0 flex flex-wrap gap-x-8 gap-y-4">
      <Figure value={String(time.done)} label="tickets done" />
      <Figure value={span(time.medianSeconds)} label="median issue to done" />
      <Figure value={rounds(time.verifyRoundsPerTicket)} label="Verify rounds per ticket" />
      <Figure value={rounds(time.verifyRoundsMedian)} label="median Verify rounds per ticket" />
      <Figure value={percent(time.moreThanOneRoundShare)} label="tickets with more than one Verify round" />
      <Figure value={percent(time.sentBackShare)} label="tickets with a Result you sent back" />
      <Figure value={String(view.autoAccepted.total)} label="Results accepted by the factory" />
      <Figure value={String(view.autoAccepted.sentBack)} label="of those sent back later" />
      <Figure
        value={usd(cost.total.medianPerTicket)}
        label={`median cost per ticket, ${cost.tickets.measured} of ${cost.tickets.all} with measured runs`}
      />
    </dl>
  )
}
