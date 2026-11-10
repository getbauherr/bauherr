import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** A boxed line of text; callers set `role` (`status` or `alert`). */
export function Alert({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert" className={cn('rounded-md border border-border bg-secondary p-3 break-all', className)} {...props} />
}
