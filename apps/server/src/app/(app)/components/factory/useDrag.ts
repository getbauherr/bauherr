'use client'
import { useState, type DragEvent, type KeyboardEvent } from 'react'

type Move = (from: number, to: number) => Promise<void>

export function useDrag(ids: number[], reorder: Move) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const from = drag === null ? -1 : ids.indexOf(drag)
  const reset = () => {
    setDrag(null)
    setOver(null)
  }
  const handlers = (index: number, id: number) => ({
    onKeyDown: (event: KeyboardEvent) => {
      const to = index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
      if (!event.altKey || to === index) return
      event.preventDefault()
      void reorder(index, to)
    },
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move'
      setDrag(id)
    },
    onDragEnd: reset,
    onDragOver: (event: DragEvent) => {
      if (drag === null) return
      event.preventDefault()
      setOver(index)
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const start = from
      reset()
      if (start >= 0) void reorder(start, index)
    },
  })
  const mark = (index: number): 'before' | 'after' | undefined => {
    if (over !== index || from === index || from < 0) return undefined
    return from > index ? 'before' : 'after'
  }
  return { dragging: drag, handlers, mark, clearOver: () => setOver(null) }
}
