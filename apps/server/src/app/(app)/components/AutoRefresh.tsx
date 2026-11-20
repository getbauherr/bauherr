'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'

const QUIET_MS = 1500
const NAVIGATING = '#nav-progress[data-active="true"]'

const versionOf = (body: unknown): number | null =>
  typeof body === 'object' && body !== null && 'v' in body && typeof body.v === 'number' ? body.v : null

const fetchVersion = async (src: string): Promise<number | null> => {
  const res = await fetch(src, { cache: 'no-store' }).catch(() => null)
  return res?.ok ? versionOf(await res.json().catch(() => null)) : null
}

const interacting = (touchedAt: number): boolean =>
  Date.now() - touchedAt < QUIET_MS || document.querySelector(NAVIGATING) !== null

export function AutoRefresh({ ms = 5000, src = '/api/changes' }: { ms?: number; src?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const busy = useRef(false)
  const seen = useRef<number | null>(null)
  const touched = useRef(0)
  busy.current = pending
  useEffect(() => {
    const touch = () => {
      touched.current = Date.now()
    }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('keydown', touch, true)
    let stale = document.visibilityState !== 'visible'
    const poll = async () => {
      if (document.visibilityState !== 'visible' || busy.current) return
      const v = await fetchVersion(src)
      if (v === null) return
      const changed = stale || (seen.current !== null && v !== seen.current)
      if (changed && interacting(touched.current)) return
      stale = false
      seen.current = v
      if (changed) start(() => router.refresh())
    }
    void poll()
    const id = setInterval(() => void poll(), ms)
    const onVisible = () => void poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('keydown', touch, true)
    }
  }, [router, ms, src])
  return null
}
