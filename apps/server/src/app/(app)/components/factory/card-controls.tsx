'use client'
import type { DraggableAttributes, useDraggable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { createContext, useContext } from 'react'
import { Button } from '../ui/button'

export type MoveTo = 'top' | 'up' | 'down'

export type CardControls = {
  label: string
  first: boolean
  last: boolean
  onMove: (to: MoveTo) => void
  activator: (node: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: ReturnType<typeof useDraggable>['listeners']
}

export const CardControlsContext = createContext<CardControls | null>(null)

export const useCardControls = () => useContext(CardControlsContext)

export function CardGrip() {
  const controls = useCardControls()
  if (!controls) return null
  return (
    <Button
      ref={controls.activator}
      variant="ghost"
      size="icon-xs"
      aria-label={`Drag ${controls.label}`}
      data-card-grip
      className="relative z-10 -ml-1.5 shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
      {...controls.attributes}
      {...controls.listeners}
    >
      <GripVertical />
    </Button>
  )
}
