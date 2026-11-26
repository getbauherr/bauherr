'use client'
import type { InboxCursor } from '../../../../core/views/inbox'
import { moreInbox } from '../../(shell)/inbox/actions'
import { INBOX_PAGE, type GroupId } from '../../lib/inbox'
import { Button } from '../ui/button'
import { useChunks } from '../useChunks'

type Props = { group: GroupId; cursor: InboxCursor; remaining: number; signature: string }

export function InboxMore({ group, cursor, remaining, signature }: Props) {
  const chunks = useChunks(signature, cursor, INBOX_PAGE, async (after, limit) => {
    const chunk = await moreInbox(group, after, limit)
    return { items: chunk.rows, cursor: chunk.cursor }
  })
  const left = remaining - chunks.items.length
  return (
    <>
      {chunks.items.length > 0 && <ul className="m-0 list-none p-0">{chunks.items}</ul>}
      {chunks.cursor !== null && left > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={chunks.load} disabled={chunks.loading}
            aria-busy={chunks.loading}>
            Show more
          </Button>
          <span className="small text-muted-foreground">{left} not shown</span>
        </div>
      )}
    </>
  )
}
