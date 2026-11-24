'use client'
import type { Decision, Outcome } from '../../../../core/retro/schema'
import { ApprovalCard } from '../assistant-ui/elements/approval-card'
import { Button } from '../ui/button'
import type { OutcomeActions, OutcomeResult } from './RetroOutcome'

type Props = {
  outcome: Outcome
  done: boolean
  repos: { product: string; factory: string }
  day: string
  actions: OutcomeActions
  take: (result: OutcomeResult) => boolean
}

const decidedText = (decision: Decision, number: number | null): string | null => {
  if (number !== null) return `Opened as #${number}.`
  if (decision === 'discard') return 'Dropped. No ticket will be opened.'
  return decision === 'keep' ? 'Kept. It opens when you press Apply.' : null
}

export function OutcomeTickets({ outcome, done, repos, day, actions, take }: Props) {
  return (
    <section aria-label="Tickets" className="grid gap-3">
      <h2 className="m-0 text-base font-semibold">Tickets</h2>
      {outcome.tickets.length === 0 && <p className="small m-0 text-muted-foreground">No ticket was proposed.</p>}
      {outcome.tickets.map((ticket) => (
        <ApprovalCard
          key={ticket.id}
          title={ticket.title}
          badge={ticket.repo === 'factory' ? 'Ticket on the factory' : 'Ticket for the product'}
          body={ticket.body}
          details={[`Opens in ${repos[ticket.repo]}`, `From Retro ${day}`]}
          decided={decidedText(ticket.decision, ticket.number)}
          locked={done}
          actions={(['keep', 'discard'] as const).map((decision) => (
            <Button
              key={decision}
              type="button"
              variant={decision === 'keep' ? 'default' : 'outline'}
              onClick={() => void actions.decideTicket(ticket.id, decision).then(take)}
            >
              {decision === 'keep' ? 'Open ticket' : 'Drop'}
            </Button>
          ))}
        />
      ))}
    </section>
  )
}
