'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'

export function AutoRefresh({ ms = 5000, src = '/api/changes' }: { ms?: number; src?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const busy = useRef(false)
  const seen = useRef<number | null>(null)
  busy.current = pending
  const touched = useRef(0)
  useEffect(() => {
    const touch = () => { touched.current = Date.now() }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('keydown', touch, true)
    let stale = document.visibilityState !== 'visible' // mounted in a hidden tab: the page may be behind, the first visible poll refreshes
    const poll = async () => {
      if (document.visibilityState !== 'visible' || busy.current) return
      try {
        const res = await fetch(src, { cache: 'no-store' })
        if (!res.ok) return
        const { v } = (await res.json()) as { v: number }
        const changed = stale || (seen.current !== null && v !== seen.current)
        if (changed && (Date.now() - touched.current < 1500 || document.querySelector('#nav-progress[data-active="true"]'))) return
        stale = false
        seen.current = v
        if (changed) start(() => router.refresh())
      } catch {
      }
    }
    poll()
    const id = setInterval(poll, ms)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('keydown', touch, true)
    }
  }, [router, ms, src])
  return null
}
