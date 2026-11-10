import type { ComponentProps } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Segmented link group: each item is a route, the active one carries `aria-pressed`. */
export function ToggleGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div role="group" data-slot="toggle-group" className={cn('flex overflow-hidden rounded-md border border-border', className)} {...props} />
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link data-slot="toggle-group-item" className={cn('px-3 py-1 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground', className)} {...props} />
}
