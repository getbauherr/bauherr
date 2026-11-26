import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'shimmer shimmer-bg rounded-md bg-muted [--shimmer-color:color-mix(in_oklab,var(--ink)_6%,transparent)]',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
