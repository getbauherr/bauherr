import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Alert({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert" className={cn('rounded-md border border-border bg-secondary p-3 break-all', className)} {...props} />
}
