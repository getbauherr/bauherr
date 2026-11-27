'use client'
import { ThreadListPrimitive } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'
import { LIST_TITLES, type InboxEntry } from '../../lib/inbox-entries'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { InboxItem } from './InboxItem'
import type { More } from './use-paged-groups'

type Props = { entries: InboxEntry[]; selected: string; more: Partial<Record<InboxEntry['group'], More>> }

function LoadMore({ more }: { more: More }) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !more.auto) return undefined
    const watcher = new IntersectionObserver((seen) => seen[0]?.isIntersecting && more.load())
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [more])
  return (
    <div ref={sentinel} className="flex items-center gap-3 px-3 py-2">
      <Button variant="outline" size="sm" onClick={more.load} disabled={more.loading} aria-busy={more.loading}>
        Show more
      </Button>
      <span className="small text-muted-foreground">{more.left} not shown</span>
    </div>
  )
}

export function InboxList({ entries, selected, more }: Props) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const firsts = new Set(entries.filter((e, i) => e.group !== entries[i - 1]?.group).map((e) => e.id))
  const lasts = new Set(entries.filter((e, i) => e.group !== entries[i + 1]?.group).map((e) => e.id))
  const waiting = entries.filter((entry) => entry.group === 'waiting').length
  return (
    <ThreadListPrimitive.Root className="flex flex-col gap-0.5">
      <ThreadListPrimitive.Items>
        {({ threadListItem }) => {
          const entry = byId.get(threadListItem.id)
          if (!entry) return null
          const rest = lasts.has(entry.id) ? more[entry.group] : undefined
          return (
            <>
              {firsts.has(entry.id) && (
                <h2 className="mono text-muted-foreground mt-3 flex items-center justify-between gap-2 px-3 py-1">
                  {LIST_TITLES[entry.group]}
                  {entry.group === 'waiting' && (
                    <span className="flex w-12 justify-end"><Badge variant="accent">{waiting}</Badge></span>
                  )}
                </h2>
              )}
              <InboxItem entry={entry} active={entry.id === selected} />
              {rest && rest.left > 0 && <LoadMore more={rest} />}
            </>
          )
        }}
      </ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  )
}
