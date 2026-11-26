'use client'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ReactNode } from 'react'
import type { MoveTo } from './card-controls'
import { LaneMoreButton } from './LaneMoreButton'
import { SortableItem } from './SortableItem'
import { announcements, INSTRUCTIONS } from './sort-announcements'
import { useLaneMore, type LaneMore } from './useLaneMore'
import { useOrder, type Item } from './useOrder'

export type { LaneMore }

const TARGETS: Record<MoveTo, (index: number) => number> = { top: () => 0, up: (i) => i - 1, down: (i) => i + 1 }

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

export function SortableCards({ items, more }: { items: Item<ReactNode>[]; more?: LaneMore | undefined }) {
  const lane = useLaneMore(items, more)
  const { order, reorder, failed, status } = useOrder(lane.all, lane.total)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = order.map((card) => card.id)
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    void reorder(ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)))
  }
  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        onDragEnd={onDragEnd}
        accessibility={{ announcements: announcements(order), screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="m-0 grid list-none gap-2 p-0">
            {order.map((card, index) => (
              <SortableItem
                key={card.id}
                card={card}
                first={index === 0}
                last={index === order.length - 1}
                onMove={(to) => void reorder(index, TARGETS[to](index))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {lane.left > 0 && <LaneMoreButton left={lane.left} loading={lane.loading} load={lane.load} />}
      {failed && (
        <p role="alert" className="small text-destructive">Could not save the new order. The board was reloaded.</p>
      )}
      <p role="status" className="sr-only">{status}</p>
    </>
  )
}
