import Link from 'next/link'
import type { Hold } from '../../../../core/views/holds'
import { RUN_NAMES } from '../../lib/factory'
import { Time } from '../Time'

const LINK = 'text-primary underline underline-offset-2'
const STRIP = 'flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-warn bg-card px-4 py-2.5'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function StuckLinks({ tickets }: { tickets: { recordId: number; number: number }[] }) {
  return tickets.map((ticket, index) => (
    <span key={ticket.recordId}>
      {index > 0 && ', '}
      <Link href={`/tickets/${ticket.recordId}`} className={LINK}>#{ticket.number}</Link>
    </span>
  ))
}

function Sentence({ hold }: { hold: Hold }) {
  switch (hold.kind) {
    case 'tickets-stuck':
      return (
        <>
          {plural(hold.tickets.length, 'ticket is', 'tickets are')} stuck and wait for your answer:{' '}
          <StuckLinks tickets={hold.tickets} />
        </>
      )
    case 'product-observing':
      return (
        <>
          {hold.name} is still observing: {plural(hold.waiting, 'ticket is', 'tickets are')} prepared, none
          started.{' '}
          <Link href={`/settings/products/${hold.product}`} className={LINK}>Switch on</Link>
        </>
      )
    case 'no-agent-connected':
      return (
        <>
          No {hold.role} session is connected: {plural(hold.queued, 'run waits', 'runs wait')} (
          {hold.byStage.map((row) => `${RUN_NAMES[row.stage]} ${row.queued}`).join(', ')}).{' '}
          <Link href="/settings/api-key" className={LINK}>Connect a session</Link>
        </>
      )
    case 'runner-idle':
      return <>The Runner has not picked up a run for 10 minutes: {plural(hold.queued, 'run waits', 'runs wait')}.</>
    case 'sync-failed':
      return (
        <>
          The sync of <span className="mono">{hold.repo}</span> failed: {hold.error}
          {hold.at && <> (<Time iso={hold.at} />)</>}
        </>
      )
  }
}

export function HoldStrip({ holds }: { holds: Hold[] }) {
  if (!holds.length) return null
  return (
    <section aria-labelledby="holding" className={STRIP}>
      <h2 id="holding" className="label text-warn">Holding up work</h2>
      {holds.map((hold) => (
        <p key={`${hold.kind}-${JSON.stringify(hold)}`} className="small">
          <Sentence hold={hold} />
        </p>
      ))}
    </section>
  )
}
