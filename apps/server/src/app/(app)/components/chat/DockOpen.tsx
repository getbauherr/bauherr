'use client'
import type { ComponentProps } from 'react'
import { Button } from '../ui/button'
import { request } from './dock-state'

type ButtonProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'type'>

/** Opens the docked chat on the Ticket's thread with the composer ready for `/comment`. Questions are answered in the refinement panel on the Ticket page, never here. */
export function DockOpen({ ticket, ...props }: { ticket: number } & ButtonProps) {
  return <Button type="button" data-testid="dock-comment" onClick={() => request({ ticket, mode: 'comment' })} {...props} />
}
