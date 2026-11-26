'use client'
import { useEffect, useRef } from 'react'
import { Button } from '../ui/button'

type Props = { left: number; loading: boolean; load: () => void }

export function LaneMoreButton({ left, loading, load }: Props) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = end.current
    if (!node) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load()
    })
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [load])
  return (
    <div ref={end}>
      <Button variant="outline" size="sm" className="w-full" onClick={load} disabled={loading} aria-busy={loading}>
        Show {left} more
      </Button>
    </div>
  )
}
