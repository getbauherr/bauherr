import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Scrolls horizontally on narrow screens; callers give the header row className="label". */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table data-slot="table" className={cn('w-full border-collapse border border-border bg-card text-left [&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_th]:bg-secondary [&_th]:px-4 [&_th]:py-2 [&_th]:text-left', className)} {...props} />
    </div>
  )
}
