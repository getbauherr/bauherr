import Link from 'next/link'
import { cn } from '@/lib/utils'
import { STATUS_WORDS } from '../../lib/status-words'
import { ticketPath, type InboxEntry } from '../../lib/inbox-entries'
import { mono } from '../assistant-ui/elements/surfaces'
import { LiveDot } from '../LiveDot'
import { Time } from '../Time'

const SHOWN = 3

function Refs({ entry }: { entry: InboxEntry }) {
  return entry.tickets.map((ticket) => (
    <Link key={ticket.recordId} href={ticketPath(ticket.recordId)} className="mono hover:underline">
      #{ticket.number}
    </Link>
  ))
}

function Line({ entry }: { entry: InboxEntry }) {
  const session = entry.kind === 'session'
  const word = entry.status ? STATUS_WORDS[entry.status].word : `${entry.title} connected`
  return (
    <span className="flex items-center gap-1.5">
      <LiveDot className={session ? 'text-ok' : 'text-primary'} />
      <span>{word}{session && entry.tickets.length > 0 ? ' on' : ''}</span>
      <Refs entry={entry} />
      {entry.since && <Time iso={entry.since} />}
    </span>
  )
}

export function StatusLine({ entries, className }: { entries: InboxEntry[]; className?: string }) {
  const working = entries.filter((entry) => entry.group === 'working')
  if (working.length === 0) return null
  return (
    <div
      aria-label="Work in progress"
      className={cn(mono, 'text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1', className)}
    >
      {working.slice(0, SHOWN).map((entry) => <Line key={entry.id} entry={entry} />)}
      {working.length > SHOWN && <span>+{working.length - SHOWN} more</span>}
    </div>
  )
}
