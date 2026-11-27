'use client'
import type { Decision, Outcome } from '../../../../core/retro/schema'
import { ApprovalCard } from '../assistant-ui/elements/approval-card'
import type { OutcomeActions, OutcomeResult } from './RetroOutcome'

type Props = {
  outcome: Outcome
  done: boolean
  repos: { product: string; factory: string }
  day: string
  actions: OutcomeActions
  take: (result: OutcomeResult) => boolean
}

const pendingText = (decision: Decision): string =>
  decision === 'discard' ? 'Dropped. No ticket will be opened.' : 'Kept. It opens when you press Apply.'

const stateOf = (number: number | null, done: boolean) => {
  if (number !== null) return { state: 'done' as const, statusLabel: `Opened as #${number}` }
  if (done) return { state: 'denied' as const, statusLabel: 'Dropped. No ticket was opened.' }
  return { state: 'request' as const }
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
          subtitle={ticket.repo === 'factory' ? 'Ticket on the factory' : 'Ticket for the product'}
          description={ticket.body}
          details={[
            { label: 'Opens in', value: repos[ticket.repo] },
            { label: 'From', value: `Retro ${day}` },
            ...(done ? [] : [{ label: 'Status', value: pendingText(ticket.decision) }]),
          ]}
          {...stateOf(ticket.number, done)}
          quiet
          allowOnceLabel="Open ticket"
          denyLabel="Drop"
          onAllowOnce={() => void actions.decideTicket(ticket.id, 'keep').then(take)}
          onDeny={() => void actions.decideTicket(ticket.id, 'discard').then(take)}
        />
      ))}
    </section>
  )
}
