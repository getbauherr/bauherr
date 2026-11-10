import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn('h-9 rounded-md border border-border bg-secondary px-3 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground aria-invalid:border-destructive', className)} {...props} />
}
