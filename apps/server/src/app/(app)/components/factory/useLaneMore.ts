'use client'
import { useMemo, type ReactNode } from 'react'
import type { Stage } from '../../../../core/events'
import type { LaneCursor } from '../../../../core/views/lanes'
import { moreCards } from '../../(shell)/lane-actions'
import type { Show } from '../../lib/factory'
import { useChunks } from '../useChunks'
import type { Item } from './useOrder'

export type LaneMore = {
  stage: Exclude<Stage, 'done'>
  pageSize: number
  show: Show
  product: number | undefined
  total: number
  cursor: LaneCursor | null
}

export function useLaneMore(items: Item<ReactNode>[], more: LaneMore | undefined) {
  const chunks = useChunks(more?.cursor ?? null, more?.pageSize ?? 0, (cursor: LaneCursor, limit: number) =>
    moreCards({ stage: more!.stage, show: more!.show, product: more!.product, cursor, limit }),
  )
  const all = useMemo(() => {
    const seen = new Set(items.map((item) => item.id))
    return [...items, ...chunks.items.filter((item) => !seen.has(item.id))]
  }, [items, chunks.items])
  const left = more && chunks.cursor !== null ? Math.min(Math.max(more.total - all.length, 1), more.pageSize) : 0
  return { all, left, total: more?.total ?? all.length, loading: chunks.loading, load: chunks.load }
}
