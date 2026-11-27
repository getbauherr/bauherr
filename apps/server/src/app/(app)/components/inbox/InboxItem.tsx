'use client'
import { ThreadListItemPrimitive } from '@assistant-ui/react'
import { CheckIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { InboxEntry } from '../../lib/inbox-entries'
import { LiveDot } from '../LiveDot'
import { Button } from '../ui/button'

const TRAIL = 'flex w-12 shrink-0 items-center justify-end'
const SWAP = 'group-focus-within/entry:opacity-0 group-hover/entry:opacity-0'

function Marker({ entry }: { entry: InboxEntry }) {
  if (entry.kind === 'session') return <LiveDot className="text-ok" />
  if (entry.group === 'working') return <LiveDot className="text-primary" />
  if (entry.group === 'failed') return <span aria-hidden className="size-1.5 rounded-full bg-danger" />
  if (entry.group === 'waiting') return <span aria-hidden className="size-1.5 rounded-full bg-warn" />
  if (entry.group === 'decided') return <CheckIcon className="size-3.5 text-ok" aria-hidden />
  return null
}

const ROW = 'h-auto w-full justify-between gap-2 px-3 py-2 text-start font-normal'

function Label({ entry }: { entry: InboxEntry }) {
  return (
    <span className="small flex min-w-0 flex-1 items-baseline gap-2 truncate">
      <span className="mono text-muted-foreground shrink-0">{entry.number === null ? '' : `#${entry.number}`}</span>
      <span className="min-w-0 truncate" title={entry.title}>{entry.title}</span>
    </span>
  )
}

export function InboxItem({ entry, active }: { entry: InboxEntry; active: boolean }) {
  const held = entry.kind === 'held'
  return (
    <ThreadListItemPrimitive.Root className="group/entry relative" data-inbox-row={entry.id}>
      {held ? (
        <Button asChild variant="ghost" className={cn(ROW, 'text-muted-foreground')}>
          <a href={entry.href} target="_blank" rel="noopener noreferrer">
            <Label entry={entry} />
            <span className="sr-only">(opens in new tab)</span>
            <span className={TRAIL}><ExternalLinkIcon className="size-3.5" aria-hidden /></span>
          </a>
        </Button>
      ) : (
        <ThreadListItemPrimitive.Trigger asChild>
          <Button
            variant="ghost"
            aria-current={active}
            className={cn(ROW, active && 'bg-accent', entry.group === 'decided' && 'text-muted-foreground')}
          >
            <Label entry={entry} />
            <span className={cn(TRAIL, SWAP)}><Marker entry={entry} /></span>
          </Button>
        </ThreadListItemPrimitive.Trigger>
      )}
      {!held && (
        <Link
          href={entry.href}
          aria-label={`Open ${entry.number === null ? entry.title : `#${entry.number}`}`}
          className={cn(
            'text-muted-foreground hover:text-foreground absolute top-1/2 right-3 flex w-12 -translate-y-1/2',
            'justify-end opacity-0 group-focus-within/entry:opacity-100 group-hover/entry:opacity-100',
          )}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      )}
    </ThreadListItemPrimitive.Root>
  )
}
