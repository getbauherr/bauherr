'use client'
import { useLinkStatus } from 'next/link'

/** Child of a `<Link>`: marks the link while its navigation is pending (`app.css` pulses the link and shows `#nav-progress`). Hidden, so no layout shift. */
export function LinkPending() {
  const { pending } = useLinkStatus()
  return <span hidden data-pending={pending} aria-busy={pending} />
}
