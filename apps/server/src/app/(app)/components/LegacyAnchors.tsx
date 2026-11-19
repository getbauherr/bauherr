'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const MOVED: Record<string, string> = { tiers: '/settings/models#tiers', health: '/settings/health' }

export function LegacyAnchors() {
  const router = useRouter()
  useEffect(() => {
    const to = MOVED[location.hash.slice(1)]
    if (to) router.replace(to)
  }, [router])
  return null
}
