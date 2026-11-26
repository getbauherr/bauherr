'use client'
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import type { Stage } from '../../../../core/events'
import type { LaneCursor } from '../../../../core/views/lanes'
import { moreCards } from '../../(shell)/lane-actions'
import type { Show } from '../../lib/factory'
import type { Item } from './useOrder'

export type LaneMore = {
  stage: Exclude<Stage, 'done'>
  pageSize: number
  show: Show
  product: number | undefined
  total: number
  cursor: LaneCursor | null
}

type Loaded = { items: Item<ReactNode>[]; cursor: LaneCursor | null }

export function useLaneMore(items: Item<ReactNode>[], more: LaneMore | undefined) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, start] = useTransition()
  const signature = items.map((item) => item.id).sort().join()
  useEffect(() => setLoaded(null), [signature])
  const all = useMemo(() => {
    const seen = new Set(items.map((item) => item.id))
    return [...items, ...(loaded?.items ?? []).filter((item) => !seen.has(item.id))]
  }, [items, loaded])
  const cursor = loaded ? loaded.cursor : (more?.cursor ?? null)
  const load = useCallback(() => {
    if (!more || cursor === null || loading) return
    start(async () => {
      const chunk = await moreCards({ stage: more.stage, show: more.show, product: more.product, cursor })
      setLoaded((before) => ({ items: [...(before?.items ?? []), ...chunk.items], cursor: chunk.cursor }))
    })
  }, [more, cursor, loading])
  const left = more && cursor !== null ? Math.min(Math.max(more.total - all.length, 1), more.pageSize) : 0
  return { all, left, loading, load }
}
