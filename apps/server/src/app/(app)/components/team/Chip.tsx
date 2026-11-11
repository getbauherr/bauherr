import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

/** Sentence-case tag; `muted` for skills, plain for facts. */
export function Chip({ className, muted, ...props }: ComponentProps<'span'> & { muted?: boolean }) {
  return <span className={cn('small inline-flex max-w-full items-center truncate rounded-sm border px-2 py-0.5', muted ? 'border-transparent bg-secondary text-muted-foreground' : 'border-border bg-card', className)} {...props} />
}
