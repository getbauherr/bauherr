import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Radio({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn('size-4 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  )
}
