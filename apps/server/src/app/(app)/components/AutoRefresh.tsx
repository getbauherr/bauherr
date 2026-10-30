'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function AutoRefresh({ ms = 15000 }: { ms?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && router.refresh(), ms)
    return () => clearInterval(id)
  }, [router, ms])
  return null
}
