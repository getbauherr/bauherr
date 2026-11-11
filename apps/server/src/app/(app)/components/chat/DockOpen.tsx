'use client'
import type { ComponentProps } from 'react'
import { Button } from '../ui/button'
import { request } from './dock-state'

/** Opens the docked chat on the Ticket's thread: `answer` shows its question card, `comment` leaves the composer ready for `/comment`. */
export function DockOpen({ ticket, mode, ...props }: { ticket: number; mode: 'answer' | 'comment' } & Omit<ComponentProps<typeof Button>, 'onClick' | 'type'>) {
  return <Button type="button" data-testid={`dock-${mode}`} onClick={() => request({ ticket, mode })} {...props} />
}
