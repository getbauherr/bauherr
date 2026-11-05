'use client'

import type { PointerEvent } from 'react'
import { Ellipsis } from './icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

export type CardAction = { label: string; run: () => void; disabled: boolean }

const LONG_PRESS_MS = 500
const SLOP_PX = 8

let timer: ReturnType<typeof setTimeout> | undefined
let at = [0, 0]
const stop = () => clearTimeout(timer)

/** Pointer handlers that call `onLong` after a 500 ms touch press that stays put (one pointer at a time, so the timer is shared). */
export const longPress = (onLong: () => void) => ({
  onPointerDown: (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return
    at = [e.clientX, e.clientY]
    timer = setTimeout(onLong, LONG_PRESS_MS)
  },
  onPointerMove: (e: PointerEvent) => {
    if (Math.hypot(e.clientX - at[0], e.clientY - at[1]) > SLOP_PX) stop()
  },
  onPointerUp: stop,
  onPointerCancel: stop,
})

/** The "⋯" button and its menu; the card opens the same menu on right-click and long-press through `open`. */
export function CardMenu({ open, onOpenChange, actions }: { open: boolean; onOpenChange: (open: boolean) => void; actions: CardAction[] }) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Card actions" className="menu absolute top-1 right-1 flex size-7 items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-secondary focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
          <Ellipsis />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((a) => (
          // preventDefault on pointerup: the button that opened the menu by right-click is released over an item, which must not select it
          <DropdownMenuItem key={a.label} disabled={a.disabled} onSelect={a.run} onPointerUp={(e) => e.preventDefault()}>{a.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
