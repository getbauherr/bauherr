'use client'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Scrolls horizontally on narrow screens; callers give the header row className="label". Only while it scrolls is the wrapper a named, focusable region (WCAG 2.1.1: a keyboard reaches scrolled content), so a table that fits adds no tab stop. */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  const box = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return (
    <div ref={box} className="overflow-x-auto" {...(scrolls ? { tabIndex: 0, role: 'group', 'aria-label': 'Scrollable table' } : {})}>
      <table data-slot="table" className={cn('w-full border-collapse border border-border bg-card text-left [&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_th]:bg-secondary [&_th]:px-4 [&_th]:py-2 [&_th]:text-left', className)} {...props} />
    </div>
  )
}
