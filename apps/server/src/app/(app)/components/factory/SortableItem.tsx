'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CardControlsContext, type MoveTo } from './card-controls'
import type { Item } from './useOrder'

const ITEM = cn(
  'relative rounded-md transition-opacity duration-(--duration-state) ease-(--ease-out)',
  'motion-reduce:transition-none!',
)
const LIFTED = 'z-20 shadow-lg ring-1 ring-primary/40'

type Props = {
  card: Item<ReactNode>
  first: boolean
  last: boolean
  onMove: (to: MoveTo) => void
}

export function SortableItem({ card, first, last, onMove }: Props) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.id,
  })
  return (
    <li
      ref={setNodeRef}
      data-card={card.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(ITEM, card.dimmed && 'opacity-20', isDragging && LIFTED)}
    >
      <CardControlsContext.Provider
        value={{ label: card.label, first, last, onMove, activator: setActivatorNodeRef, attributes, listeners }}
      >
        {card.node}
      </CardControlsContext.Provider>
    </li>
  )
}
