'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Where the sections of the old General page live now; a `#anchor` is never sent to the server, so the page forwards it. */
const MOVED: Record<string, string> = { tiers: '/settings/models#tiers', 'run-mode': '/settings/models#run-mode', knowledge: '/settings/knowledge', health: '/settings/health' }

export function LegacyAnchors() {
  const router = useRouter()
  useEffect(() => {
    const to = MOVED[location.hash.slice(1)]
    if (to) router.replace(to)
  }, [router])
  return null
}
