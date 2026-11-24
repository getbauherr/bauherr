'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { prepareOpeningAction } from '../../(shell)/memory/retro/actions'
import { Button } from '../ui/button'

export function PreparingOpening({ retro }: { retro: number }) {
  const router = useRouter()
  const asked = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void prepareOpeningAction(retro).then((result) => {
      setError(result.error ?? null)
      if (!result.error) router.refresh()
    })
  }, [retro, router, attempt])
  const again = () => {
    asked.current = false
    setError(null)
    setAttempt(attempt + 1)
  }
  if (error) {
    return (
      <div className="grid gap-2">
        <p role="alert" className="m-0 text-destructive">
          {error}
        </p>
        <Button type="button" variant="outline" className="w-fit" onClick={again}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <p role="status" className="m-0 text-muted-foreground">
      The factory is preparing the opening...
    </p>
  )
}
