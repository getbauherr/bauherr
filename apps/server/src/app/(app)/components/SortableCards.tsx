'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { rankTicketAction } from '../lib/actions'
import { cn } from '@/lib/utils'
import { Card } from './ui/card'

const before = "before:pointer-events-none before:absolute before:inset-x-0 before:-top-2 before:h-0.5 before:rounded-[1px] before:bg-primary before:content-['']"
const after = "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-2 after:h-0.5 after:rounded-[1px] after:bg-primary after:content-['']"
const stripe = 'border-primary [background:linear-gradient(var(--accent),var(--accent))_left_top/3px_40%_no-repeat,var(--surface-000)] animate-stripe motion-reduce:animate-none motion-reduce:[background-size:3px_100%]'

type Item = { id: number; node: ReactNode; movable: boolean; running?: boolean }

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
      className="flex flex-col gap-3"
      onDragLeave={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) setTarget(null)
      }}
    >
      {failed && <p className="small text-muted-foreground" role="alert">Could not save the new order.</p>}
      {order.map((it, i) => (
      <Card
        asChild
        key={it.id}
        className={cn(
          'card relative items-start gap-1 bg-background p-3',
          it.movable && 'cursor-grab',
          it.running && stripe,
          drag === it.id && 'opacity-50',
          drop === i && (from > i ? before : after),
        )}
        data-drop={drop === i ? (from > i ? 'before' : 'after') : undefined}
        data-ticket={it.id}
        data-running={it.running || undefined}
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
        <article>
          <span className="mono small absolute top-2 right-3 text-muted-foreground" aria-label={`Position ${i + 1}`}>{i + 1}</span>
          {it.node}
        </article>
      </Card>
      ))}
    </div>
  )
}
