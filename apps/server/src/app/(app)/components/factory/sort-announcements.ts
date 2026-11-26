import type { Announcements, UniqueIdentifier } from '@dnd-kit/core'
import type { Item } from './useOrder'

export const INSTRUCTIONS =
  'To pick up a ticket, press Space or Enter on its drag handle. ' +
  'Use the arrow keys to move it, Space or Enter to drop it, Escape to cancel.'

export const announcements = (order: Item<unknown>[]): Announcements => {
  const where = (id: UniqueIdentifier) => `position ${order.findIndex((card) => card.id === id) + 1} of ${order.length}`
  const name = (id: UniqueIdentifier) => order.find((card) => card.id === id)?.label ?? 'ticket'
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}, ${where(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over ${where(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${name(active.id)} at ${where(over.id)}.` : `${name(active.id)} was dropped where it started.`,
    onDragCancel: ({ active }) => `Move cancelled. ${name(active.id)} stays at ${where(active.id)}.`,
  }
}
