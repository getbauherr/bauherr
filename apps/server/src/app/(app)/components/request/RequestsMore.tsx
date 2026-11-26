'use client'
import type { ReactNode } from 'react'
import type { RequestCursor } from '../../../../core/views/request-list'
import type { RequestFilter } from '../../../../core/views/request-status'
import { REQUEST_PAGE } from '../../lib/chunks'
import { Button } from '../ui/button'
import { useChunks } from '../useChunks'

type Chunk = { rows: ReactNode[]; cursor: RequestCursor | null }
type Request = { product: number; show: RequestFilter; cursor: RequestCursor; limit?: number }

type Load = (request: Request) => Promise<Chunk>

export type MoreRequests = Omit<Request, 'limit'> & { left: number; loadMore: Load }

export function RequestsMore({ product, show, cursor, left, loadMore }: MoreRequests) {
  const chunks = useChunks(cursor, REQUEST_PAGE, async (after, limit) => {
    const chunk = await loadMore({ product, show, cursor: after, limit })
    return { items: chunk.rows, cursor: chunk.cursor }
  })
  const rest = left - chunks.items.length
  return (
    <>
      {chunks.items}
      {chunks.cursor !== null && rest > 0 && (
        <div role="row" className="flex items-center gap-3 border-t border-border px-4 py-3">
          <div role="cell">
            <Button variant="outline" size="sm" onClick={chunks.load} disabled={chunks.loading}
            aria-busy={chunks.loading}>
              Show more
            </Button>
          </div>
          <span role="cell" className="small text-muted-foreground">{rest} not shown</span>
        </div>
      )}
    </>
  )
}
