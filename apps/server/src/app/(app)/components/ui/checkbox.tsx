import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** shadcn-style Checkbox on a native input (`@radix-ui/react-checkbox` is not a dependency); same `checked`/`disabled` props, `onChange` instead of `onCheckedChange`. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="checkbox" data-slot="checkbox" className={cn('size-4 shrink-0 cursor-pointer rounded-sm border border-border bg-secondary accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />
}
