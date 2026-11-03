import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const variants = cva('label inline-flex items-center gap-1 rounded-sm border border-current bg-card px-2 py-1 transition-colors duration-(--duration-state) ease-(--ease-out)', {
  variants: {
    variant: {
      neutral: 'border-border text-muted-foreground',
      muted: 'text-muted-foreground',
      accent: 'text-primary',
      ok: 'text-ok',
      warn: 'text-warn',
      destructive: 'text-destructive',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof variants>) {
  return <span data-slot="badge" className={cn(variants({ variant }), className)} {...props} />
}
