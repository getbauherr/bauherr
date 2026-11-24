'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { moveCard } from '../../(shell)/actions'

export type Item<T> = { id: number; label: string; dimmed: boolean; node: T }

const moved = <T,>(items: Item<T>[], from: number, to: number): Item<T>[] => {
  const next = [...items]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

export function useOrder<T>(items: Item<T>[]) {
  const router = useRouter()
  const [order, setOrder] = useState(items)
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState('')
  const focus = useRef<number | null>(null)
  useEffect(() => setOrder(items), [items])
  useLayoutEffect(() => {
    if (focus.current === null) return
    document.querySelector<HTMLElement>(`[data-card="${focus.current}"] [data-card-link]`)?.focus()
    focus.current = null
  }, [order])

  const reorder = async (from: number, to: number) => {
    const card = order[from]
    if (!card || to === from || to < 0 || to >= order.length) return
    const next = moved(order, from, to)
    setOrder(next)
    setFailed(false)
    setStatus('')
    focus.current = card.id
    const result = await moveCard(card.id, next[to - 1]?.id ?? null).catch(() => ({ moved: false }))
    if (result.moved) setStatus(`Moved ${card.label} to position ${to + 1} of ${order.length}`)
    else setFailed(true)
    router.refresh()
  }
  return { order, reorder, failed, status }
}
