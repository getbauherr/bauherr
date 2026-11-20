'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CardMenu, type MoveTo } from './CardMenu'
import { useDrag } from './useDrag'
import { useOrder, type Item } from './useOrder'

const FADE = 'transition-opacity duration-(--duration-state) ease-(--ease-out) motion-reduce:transition-none'
const MARK = cn(
  'data-[drop]:before:absolute data-[drop]:before:inset-x-0 data-[drop]:before:h-0.5',
  'data-[drop]:before:bg-primary data-[drop]:before:content-[""]',
  'data-[drop=before]:before:-top-1.5 data-[drop=after]:before:-bottom-1.5',
)
const ITEM = 'group/card relative'
const HINT = 'Drag, or press Alt+ArrowUp or Alt+ArrowDown, to move'

const TARGETS: Record<MoveTo, (index: number) => number> = { top: () => 0, up: (i) => i - 1, down: (i) => i + 1 }

export function SortableCards({ items }: { items: Item<ReactNode>[] }) {
  const { order, reorder, failed, status } = useOrder(items)
  const { dragging, handlers, mark, clearOver } = useDrag(order.map((card) => card.id), reorder)
  return (
    <>
      <ul className="m-0 grid list-none gap-2 p-0" onDragLeave={clearOver}>
        {order.map((card, index) => (
          <li
            key={card.id}
            data-card={card.id}
            data-drop={mark(index)}
            draggable
            title={HINT}
            className={cn(ITEM, FADE, MARK, card.dimmed && 'opacity-20', dragging === card.id && 'opacity-50')}
            {...handlers(index, card.id)}
          >
            {card.node}
            <CardMenu
              label={card.label}
              first={index === 0}
              last={index === order.length - 1}
              onMove={(to) => void reorder(index, TARGETS[to](index))}
            />
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="small text-destructive">Could not save the new order. The board was reloaded.</p>
      )}
      <p role="status" className="sr-only">{status}</p>
    </>
  )
}
