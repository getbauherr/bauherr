'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { MAX_WINDOW } from '../lib/chunks'

export type Chunk<T, C> = { items: T[]; cursor: C | null }

const NONE: never[] = []

export function useChunks<T, C>(
  first: C | null,
  pageSize: number,
  fetchAfter: (cursor: C, limit: number) => Promise<Chunk<T, C>>,
) {
  const [loaded, setLoaded] = useState<Chunk<T, C> | null>(null)
  const [loading, start] = useTransition()
  const size = useRef(0)
  size.current = loaded?.items.length ?? 0
  const latest = useRef(fetchAfter)
  latest.current = fetchAfter
  useEffect(() => {
    if (size.current === 0) return
    if (first === null) return setLoaded(null)
    let live = true
    void latest.current(first, Math.min(size.current, MAX_WINDOW)).then((chunk) => live && setLoaded(chunk))
    return () => {
      live = false
    }
  }, [first])
  const cursor = loaded ? loaded.cursor : first
  const load = useCallback(() => {
    if (cursor === null || loading) return
    start(async () => {
      const chunk = await latest.current(cursor, pageSize)
      setLoaded((before) => ({ items: [...(before?.items ?? []), ...chunk.items], cursor: chunk.cursor }))
    })
  }, [cursor, loading, pageSize])
  return { items: loaded?.items ?? NONE, cursor, loading, load }
}
