import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('font-medium text-foreground', className)} {...props} />
}
