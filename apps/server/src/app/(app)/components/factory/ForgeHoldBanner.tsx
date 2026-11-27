'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '../ui/alert'

export type HoldView = { message: string; until: string }

export function ForgeHoldBanner({ holds }: { holds: HoldView[] }) {
  const router = useRouter()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const ends = holds.map((hold) => Date.parse(hold.until)).filter((end) => end > Date.now())
    if (ends.length === 0) return
    const timer = setTimeout(() => {
      setNow(Date.now())
      router.refresh()
    }, Math.min(...ends) - Date.now())
    return () => clearTimeout(timer)
  }, [holds, router])
  return holds
    .filter((hold) => Date.parse(hold.until) > now)
    .map((hold) => (
      <Alert key={hold.message} className="border-warn">
        <AlertDescription>{hold.message}</AlertDescription>
      </Alert>
    ))
}
