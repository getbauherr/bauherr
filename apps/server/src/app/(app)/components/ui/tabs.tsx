import type { ComponentProps } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Link tabs: each tab is a route, the current one carries `aria-current` (roles stay link, not tab). */
export function Tabs({ className, ...props }: ComponentProps<'nav'>) {
  return <nav data-slot="tabs" className={cn('flex gap-4', className)} {...props} />
}

export function Tab({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="tab"
      className={cn('-mb-px flex h-10 items-center border-b border-transparent text-muted-foreground transition-colors duration-(--duration-state) ease-(--ease-out) hover:text-foreground aria-[current]:border-primary aria-[current]:text-foreground', className)}
      {...props}
    />
  )
}
