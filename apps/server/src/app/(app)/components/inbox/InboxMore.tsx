'use client'
import { useEffect, useState, useTransition, type ReactNode } from 'react'
import type { InboxCursor } from '../../../../core/views/inbox'
import { moreInbox } from '../../(shell)/inbox/actions'
import type { GroupId } from '../../lib/inbox'
import { Button } from '../ui/button'

type Props = { group: GroupId; cursor: InboxCursor; remaining: number; signature: string }
type Loaded = { rows: ReactNode[]; cursor: InboxCursor | null }

export function InboxMore({ group, cursor, remaining, signature }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [pending, start] = useTransition()
  useEffect(() => setLoaded(null), [signature])
  const next = loaded ? loaded.cursor : cursor
  const left = remaining - (loaded?.rows.length ?? 0)
  const load = () => {
    if (next === null) return
    start(async () => {
      const chunk = await moreInbox(group, next)
      setLoaded((before) => ({ rows: [...(before?.rows ?? []), ...chunk.rows], cursor: chunk.cursor }))
    })
  }
  return (
    <>
      {loaded && <ul className="m-0 list-none p-0">{loaded.rows}</ul>}
      {next !== null && left > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={load} disabled={pending} aria-busy={pending}>
            Show more
          </Button>
          <span className="small text-muted-foreground">{left} not shown</span>
        </div>
      )}
    </>
  )
}
