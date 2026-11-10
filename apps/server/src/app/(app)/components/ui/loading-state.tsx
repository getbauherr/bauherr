'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** assistant-ui's `GenerationLoader` (elements/loading-state), added by hand: the registry item needs `tw-shimmer`, so the label is a plain span and the tick is its own interval. */
export function GenerationLoader({ label, className, ...props }: Omit<ComponentProps<'div'>, 'children'> & { label: string }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])
  const offset = Math.floor(tick / 3)
  return (
    <div data-slot="generation-loader" role="status" className={cn('flex items-center gap-2', className)} {...props}>
      <div aria-hidden className="grid grid-cols-3 gap-0.5">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={cn('size-1 rounded-full bg-foreground transition-opacity duration-300 motion-reduce:transition-none', (i * 2 + offset) % 9 < 3 ? 'opacity-90' : 'opacity-15')} />
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}
