'use client'
import { useEffect, type ComponentProps } from 'react'
import { Button } from '../ui/button'
import { request } from './dock-state'

type ButtonProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'type'>

/** Opens the docked chat on the Ticket's thread with the composer ready for `/comment`. Questions are answered in the refinement panel on the Ticket page, never here. */
export function DockOpen({ ticket, ...props }: { ticket: number } & ButtonProps) {
  return <Button type="button" data-testid="dock-comment" onClick={() => request({ ticket, mode: 'comment' })} {...props} />
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
