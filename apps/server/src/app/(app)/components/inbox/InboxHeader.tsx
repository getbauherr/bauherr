import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import type { ThreadModel } from '../../lib/inbox-thread'
import { StatusChip } from '../StatusChip'
import { Button } from '../ui/button'

export function InboxHeader({ thread }: { thread: ThreadModel }) {
  const { number, title, href, view } = thread
  return (
    <div className="hidden items-center gap-3 px-4 min-[900px]:flex">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-baseline gap-2 hover:underline">
          <span className="mono">#{number}</span>
          <span className="small truncate">{title}</span>
        </Link>
      ) : (
        <span className="small min-w-0 flex-1 truncate">{title}</span>
      )}
      {href && (
        <Button asChild variant="ghost" size="sm">
          <Link href={href}>
            <ExternalLinkIcon /> Open ticket
          </Link>
        </Button>
      )}
      {view && <StatusChip status={view.status} closedAs={view.closedAs} />}
    </div>
  )
}
