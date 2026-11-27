'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'

const FLOAT = cn(
  '@max-[1359px]:absolute @max-[1359px]:top-0 @max-[1359px]:right-0 @max-[1359px]:z-20 @max-[1359px]:w-72',
  '@max-[1359px]:rounded-md @max-[1359px]:border @max-[1359px]:bg-background @max-[1359px]:p-2',
  '@max-[1359px]:shadow-lg',
)

export function DoneLane({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="relative min-w-0">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls="done-lane"
        onClick={() => setOpen(!open)}
        className="hidden h-auto min-h-40 w-full flex-col gap-2 py-3 md:flex @[1360px]:md:hidden"
      >
        <span className="label [writing-mode:vertical-rl]">Done</span>
        <span className="mono">{count}</span>
      </Button>
      <div id="done-lane" className={cn(open ? FLOAT : '@max-[1359px]:md:hidden')}>
        {children}
      </div>
    </div>
  )
}
