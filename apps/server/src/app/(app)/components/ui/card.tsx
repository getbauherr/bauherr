import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, asChild, ...props }: ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div'
  return <Comp data-slot="card" className={cn('flex flex-col gap-3 rounded-md border border-border bg-card p-4 text-card-foreground', className)} {...props} />
}
