import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** A native `<select>` styled like `Input`; the Radix `Select` is for lists that need custom rows. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="native-select" className={cn('h-9 rounded-md border border-border bg-secondary px-3 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground aria-invalid:border-destructive', className)} {...props} />
}
