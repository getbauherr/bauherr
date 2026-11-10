'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'

/** Polls `/api/changes` and refreshes the page only when something of the Workspace changed; idle while the tab is hidden or a refresh is in flight. */
export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const busy = useRef(false)
  const seen = useRef<number | null>(null)
  busy.current = pending
  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== 'visible' || busy.current) return
      try {
        const res = await fetch('/api/changes', { cache: 'no-store' })
        if (!res.ok) return
        const { v } = (await res.json()) as { v: number }
        const changed = seen.current !== null && v !== seen.current
        seen.current = v
        if (changed) start(() => router.refresh())
      } catch {
        // offline or restarting: the next tick tries again
      }
    }
    poll()
    const id = setInterval(poll, ms)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [router, ms])
  return null
}
