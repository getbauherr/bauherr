import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps } from 'react'
import { ChevronRight } from '../icons'
import { cn } from '@/lib/utils'

export const Breadcrumb = (props: ComponentProps<'nav'>) => <nav aria-label="Breadcrumb" data-slot="breadcrumb" {...props} />

export const BreadcrumbList = ({ className, ...props }: ComponentProps<'ol'>) => <ol data-slot="breadcrumb-list" className={cn('m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-[15px] text-muted-foreground', className)} {...props} />

export const BreadcrumbItem = ({ className, ...props }: ComponentProps<'li'>) => <li data-slot="breadcrumb-item" className={cn('inline-flex items-center gap-1.5', className)} {...props} />

export function BreadcrumbLink({ asChild, className, ...props }: ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'a'
  return <Comp data-slot="breadcrumb-link" className={cn('transition-colors duration-(--duration-state) ease-(--ease-out) hover:text-foreground', className)} {...props} />
}

export const BreadcrumbPage = ({ className, ...props }: ComponentProps<'span'>) => <span data-slot="breadcrumb-page" aria-current="page" className={cn('font-medium text-foreground', className)} {...props} />

export const BreadcrumbSeparator = ({ className, ...props }: ComponentProps<'li'>) => (
  <li data-slot="breadcrumb-separator" role="presentation" aria-hidden className={cn('[&>svg]:size-3.5', className)} {...props}>
    <ChevronRight />
  </li>
)
