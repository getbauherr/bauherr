'use client'
import { useLinkStatus } from 'next/link'

export function LinkPending() {
  const { pending } = useLinkStatus()
  return <span hidden data-pending={pending} aria-busy={pending} />
}
