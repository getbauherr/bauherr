import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** shadcn-style Switch on a native checkbox (`role="switch"`), so it posts with its form like any input; add `peer` to style siblings by its state. */
export function Switch({ className, ...props }: Omit<ComponentProps<'input'>, 'type' | 'role'>) {
  return (
    <input
      type="checkbox"
      role="switch"
      data-slot="switch"
      className={cn("relative m-0 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-sm border border-border bg-secondary outline-none transition-colors duration-(--duration-state) ease-(--ease-out) after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-[1px] after:bg-muted-foreground after:content-[''] checked:border-primary checked:bg-primary checked:after:left-[18px] checked:after:bg-primary-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60", className)}
      {...props}
    />
  )
}
