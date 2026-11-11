'use client'
import { useEffect, type ComponentProps } from 'react'
import { Button } from '../ui/button'
import { request } from './dock-state'

type ButtonProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'type'>

/** Opens the docked chat on the Ticket's thread: `answer` shows its question card, `comment` leaves the composer ready for `/comment`. */
export function DockOpen({ ticket, mode, ...props }: { ticket: number; mode: 'answer' | 'comment' } & ButtonProps) {
  return <Button type="button" data-testid={`dock-${mode}`} onClick={() => request({ ticket, mode })} {...props} />
}

/** Opens the docked chat in request mode: `'new'` for a new request, an id for the thread of that request. */
export function RequestOpen({ request: which, ...props }: { request: number | 'new' } & ButtonProps) {
  return <Button type="button" data-testid="dock-request" onClick={() => request({ request: which })} {...props} />
}

/** Opens the dock in request mode when the page loads (the `/requests/new` link): a new draft, or the draft of that request. */
export function OpenOnLoad({ request: which = 'new' }: { request?: number | 'new' }) {
  useEffect(() => request({ request: which }), [which])
  return null
}
