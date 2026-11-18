'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function TabAnchors({ tabs, current, base }: { tabs: Record<string, string>; current: string; base: string }) {
  const router = useRouter()
  useEffect(() => {
    const id = location.hash.slice(1)
    const tab = tabs[id]
    if (tab && tab !== current) router.replace(`${base}?tab=${tab}#${id}`)
  }, [tabs, current, base, router])
  return null
}
