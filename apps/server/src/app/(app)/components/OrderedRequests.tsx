'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { orderRequests } from '../lib/actions'

/** `ticket`/`product` identify the row for the order; `movable`: the viewer's own request (others' rows stay where the board puts them). */
export type OrderedItem = { session: number; ticket: number | null; product: number; movable: boolean; node: ReactNode; title: string }

/**
 * "In the factory": the person's own requests can be ordered by drag or with Move up / Move down (the keyboard path). The order is their priority among their own requests of one Product:
 * the list saves the new order of that Product's own rows, and `orderOwnRequests` lets their Tickets trade places only; nothing else on the board moves.
 */
export function OrderedRequests({ items }: { items: OrderedItem[] }) {
  const router = useRouter()
  const [order, setOrder] = useState(items)
  const [drag, setDrag] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => setOrder(items), [items])
  const same = (a: OrderedItem, b: OrderedItem) => a.movable && b.movable && a.product === b.product && a.ticket !== null && b.ticket !== null
  const reorder = async (from: number, to: number) => {
    if (from === to || !same(order[from]!, order[to]!)) return
    const next = [...order]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    setOrder(next)
    setError('')
    const r = await orderRequests(next.filter((x) => same(x, order[from]!)).map((x) => x.ticket!))
    if (r.error) setError(r.error)
    router.refresh()
  }
  const neighbour = (i: number, dir: -1 | 1) => {
    for (let j = i + dir; j >= 0 && j < order.length; j += dir) if (same(order[i]!, order[j]!)) return j
    return -1
  }
  const over = (e: DragEvent, i: number) => drag !== null && same(order[i]!, order[order.findIndex((x) => x.session === drag)]!) && e.preventDefault()
  return (
    <>
      {error && <p role="alert" className="small text-destructive">{error}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="factory-rows">
        {order.map((it, i) => (
          <li
            key={it.session}
            data-testid="factory-row"
            data-request={it.session}
            className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card p-3', drag === it.session && 'opacity-50')}
            {...(it.movable && it.ticket !== null && { draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; setDrag(it.session) }, onDragEnd: () => setDrag(null), onDragOver: (e: DragEvent) => over(e, i), onDrop: (e: DragEvent) => { e.preventDefault(); const from = order.findIndex((x) => x.session === drag); setDrag(null); if (from >= 0) void reorder(from, i) } })}
          >
            {it.node}
            {it.movable && it.ticket !== null && (
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" aria-label={`Move up: ${it.title}`} disabled={neighbour(i, -1) < 0} onClick={() => void reorder(i, neighbour(i, -1))}>Move up</Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Move down: ${it.title}`} disabled={neighbour(i, 1) < 0} onClick={() => void reorder(i, neighbour(i, 1))}>Move down</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
