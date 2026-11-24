import Link from 'next/link'
import type { RunPage } from '../../../../core/views/run'
import { workerOf } from '../../lib/factory'
import { pullLabel } from '../../lib/ticket'
import { ForgeLink } from './ForgeLink'
import { CARD } from './Section'

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export function RunLinks({ run }: { run: RunPage }) {
  const { pullRequest: pull, ticket } = run
  return (
    <section className={`${CARD} grid gap-2 p-4 [overflow-wrap:anywhere]`}>
      <h2 className="label m-0 text-muted-foreground">Links</h2>
      {pull && <ForgeLink href={pull.url} label={capital(pullLabel(pull.forge, pull.number))} />}
      <Link href={`/tickets/${ticket.recordId}`} className="text-primary hover:underline">
        Ticket #{ticket.number} {ticket.title}
      </Link>
      {run.leasedBy !== null && (
        <Link href="/settings/api-key" className="text-primary hover:underline">
          {workerOf(run.leasedBy).name}
        </Link>
      )}
    </section>
  )
}
