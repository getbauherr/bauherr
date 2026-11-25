import type { MergedTicket } from '../../../../core/releases/merged'
import type { ReleasesView } from '../../../../core/releases/view'
import { Check, CircleHelp } from '../icons'
import { TicketRef } from '../TicketRef'
import { shortDate } from '../../lib/format'

const ROW = 'grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-3 border-t border-border py-3 first:border-t-0'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function Row({ ticket }: { ticket: MergedTicket }) {
  const waiting = ticket.acceptedAt === null
  const Mark = waiting ? CircleHelp : Check
  return (
    <li className={ROW}>
      <Mark className={`mt-0.5 size-4 justify-self-center ${waiting ? 'text-warn' : 'text-ok'}`} />
      <span className="grid gap-0.5">
        <span className="font-medium">{ticket.title}</span>
        <span className="small text-muted-foreground">
          {ticket.visible ? 'Change · visible' : 'Change · internal'}
          {' · '}
          {waiting ? 'merged, waiting for your Accept' : `accepted ${shortDate(ticket.acceptedAt ?? '')}`}
        </span>
      </span>
      <TicketRef recordId={ticket.recordId} number={ticket.number} className="small" />
    </li>
  )
}

export function ReadyList({ ready }: { ready: NonNullable<ReleasesView['ready']> }) {
  const { tickets } = ready
  return (
    <section aria-labelledby="ready" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="ready" className="heading">Ready to release</h2>
        <span className="small text-muted-foreground">
          {plural(tickets.length, 'change', 'changes')} since {ready.since ?? 'the start'} · {ready.visible} visible to
          users
        </span>
      </div>
      {tickets.length === 0 ? (
        <p className="small m-0 text-muted-foreground">Nothing has been merged since {ready.since ?? 'the start'}.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {tickets.map((ticket) => <Row key={ticket.recordId} ticket={ticket} />)}
        </ul>
      )}
      <p className="small m-0 text-muted-foreground">
        A merged ticket you have not accepted yet is in the release too, because it is merged.
      </p>
    </section>
  )
}
