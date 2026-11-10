import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const variants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border text-[15px] font-medium whitespace-nowrap transition-colors duration-(--duration-state) ease-(--ease-out) outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-secondary disabled:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground hover:bg-accent-strong',
        outline: 'border-border bg-card text-foreground hover:bg-secondary',
        destructive: 'border-destructive bg-destructive text-white! hover:opacity-90',
        ghost: 'border-transparent bg-transparent text-foreground hover:bg-secondary',
      },
      size: { default: 'h-9 px-3', sm: 'h-8 px-3', icon: 'size-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({ className, variant, size, asChild, ...props }: ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" data-variant={variant ?? 'default'} className={cn(variants({ variant, size }), className)} {...props} />
}
