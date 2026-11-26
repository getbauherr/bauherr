'use client'
import { useEffect, useState, useTransition, type ReactNode } from 'react'
import type { RequestCursor } from '../../../../core/views/request-list'
import type { RequestFilter } from '../../../../core/views/request-status'
import { Button } from '../ui/button'

type Chunk = { rows: ReactNode[]; cursor: RequestCursor | null }
type Request = { product: number; show: RequestFilter; cursor: RequestCursor }

type Load = (request: Request) => Promise<Chunk>

export type MoreRequests = Request & { left: number; loadMore: Load }

type Props = MoreRequests & { signature: string }

export function RequestsMore({ product, show, cursor, left, loadMore, signature }: Props) {
  const [loaded, setChunk] = useState<Chunk | null>(null)
  const [pending, start] = useTransition()
  useEffect(() => setChunk(null), [signature])
  const next = loaded ? loaded.cursor : cursor
  const rest = left - (loaded?.rows.length ?? 0)
  const load = () => {
    if (next === null) return
    start(async () => {
      const chunk = await loadMore({ product, show, cursor: next })
      setChunk((before) => ({ rows: [...(before?.rows ?? []), ...chunk.rows], cursor: chunk.cursor }))
    })
  }
  return (
    <>
      {loaded?.rows}
      {next !== null && rest > 0 && (
        <div role="row" className="flex items-center gap-3 border-t border-border px-4 py-3">
          <div role="cell">
            <Button variant="outline" size="sm" onClick={load} disabled={pending} aria-busy={pending}>
              Show more
            </Button>
          </div>
          <span role="cell" className="small text-muted-foreground">{rest} not shown</span>
        </div>
      )}
    </>
  )
}
