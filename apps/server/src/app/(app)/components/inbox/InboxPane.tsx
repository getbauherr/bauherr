import Link from 'next/link'
import type { TicketView } from '../../../../core/views/ticket'
import { NowPane } from '../ticket/NowPane'

export function InboxPane({ view, may }: { view: TicketView; may: boolean }) {
  return (
    <aside aria-label="Decision" className="grid min-w-0 content-start gap-3 lg:sticky lg:top-4">
      <Link href="/inbox" scroll={false} className="small font-medium text-primary lg:hidden">
        ← Back
      </Link>
      <h2 className="heading">
        <Link href={`/tickets/${view.recordId}`}>
          <span className="mono">#{view.number}</span> {view.title}
        </Link>
      </h2>
      <NowPane view={view} proof={undefined} may={may} />
    </aside>
  )
}
