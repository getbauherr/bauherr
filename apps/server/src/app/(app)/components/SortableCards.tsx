'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { rankTicketAction } from '../lib/actions'

type Item = { id: number; node: ReactNode; movable: boolean }

const move = <T,>(xs: T[], from: number, to: number): T[] => {
  const out = [...xs]
  out.splice(to, 0, out.splice(from, 1)[0])
  return out
}

/** One Board column: cards sortable by drag and drop or Alt+ArrowUp/Down; a move persists via `rankTicketAction`. */
export function SortableCards({ items }: { items: Item[] }) {
  const router = useRouter()
  const [order, setOrder] = useState(items)
  const [drag, setDrag] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => setOrder(items), [items])

  const reorder = async (from: number, to: number) => {
    if (from === to) return
    const next = move(order, from, to)
    setOrder(next)
    setFailed(false)
    await rankTicketAction(next[to].id, next[to - 1]?.id ?? null, next[to + 1]?.id ?? null).catch(() => setFailed(true))
    router.refresh()
  }
  const keys = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    const to = i + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)
    if (!e.altKey || to === i || to < 0 || to >= order.length || !order[to].movable) return
    e.preventDefault()
    const id = order[i].id
    void reorder(i, to).then(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-ticket="${id}"]`)?.focus()))
  }
  const from = order.findIndex((x) => x.id === drag)
  const drop = drag !== null && target !== null && target !== from ? target : null
  const over = (i: number) => (e: DragEvent) => {
    if (drag === null) return
    if (!order[i].movable) return setTarget(null)
    e.preventDefault()
    setTarget(i)
  }
  const reset = () => {
    setDrag(null)
    setTarget(null)
  }

  return (
    <div
      className="cards"
      onDragLeave={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) setTarget(null)
      }}
    >
      {failed && <p className="muted small" role="alert">Could not save the new order.</p>}
      {order.map((it, i) => (
    <article
      key={it.id}
      className={`card${drag === it.id ? ' dragging' : ''}${drop === i ? (from > i ? ' drop-before' : ' drop-after') : ''}`}
      data-drop={drop === i ? (from > i ? 'before' : 'after') : undefined}
      data-ticket={it.id}
      {...(it.movable && {
        draggable: true,
        tabIndex: 0,
        title: 'Drag, or Alt+ArrowUp / Alt+ArrowDown, to reorder',
        onKeyDown: keys(i),
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(it.id))
          setDrag(it.id)
        },
        onDragEnd: reset,
        onDrop: (e: DragEvent) => {
          e.preventDefault()
          reset()
          if (from >= 0) void reorder(from, i)
        },
      })}
      onDragOver={over(i)}
    >
      <span className="rank mono muted small" aria-label={`Position ${i + 1}`}>{i + 1}</span>
      {it.node}
    </article>
  ))}
    </div>
  )
}
