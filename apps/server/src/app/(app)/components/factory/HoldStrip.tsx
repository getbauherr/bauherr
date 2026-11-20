import Link from 'next/link'
import type { Hold } from '../../../../core/views/holds'
import { STUCK_SENTENCES } from '../../lib/status-words'
import { Time } from '../Time'

const LINK = 'text-primary underline underline-offset-2'
const STRIP = 'flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-warn bg-card px-4 py-2.5'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function Sentence({ hold }: { hold: Hold }) {
  switch (hold.kind) {
    case 'ticket-stuck':
      return (
        <>
          <Link href={`/tickets/${hold.recordId}`} className={LINK}>#{hold.number}</Link>{' '}
          {STUCK_SENTENCES[hold.reason] ?? 'is stuck and waits for you.'}
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
        <>No {hold.role} session is connected: {plural(hold.queued, 'run waits', 'runs wait')} in {hold.stage}.</>
      )
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
