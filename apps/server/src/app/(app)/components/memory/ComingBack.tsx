import type { ComingBack } from '../../../../core/views/cost-view'
import { usd } from '../../lib/format'
import { span } from '../../lib/insights'

export function CostOfComingBack({ back }: { back: ComingBack }) {
  const cost = back.costUsd === null ? 'cost not measured' : usd(back.costUsd)
  const word = back.rounds === 1 ? 'extra round' : 'extra rounds'
  return (
    <section className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h2 className="label m-0 text-muted-foreground">Cost of coming back</h2>
      <span className="mono">{cost} · {back.rounds} {word} · {span(back.seconds)}</span>
      <span className="small text-muted-foreground">
        Build and Verify runs after the correction on the {back.tickets} {back.tickets === 1 ? 'ticket' : 'tickets'} it
        came back on. {back.measured} of {back.runs} runs measured.
      </span>
    </section>
  )
}
