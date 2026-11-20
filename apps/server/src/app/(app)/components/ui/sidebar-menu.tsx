'use client'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-context'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export const SidebarMenu = ({ className, ...props }: ComponentProps<'ul'>) => (
  <ul
    data-slot="sidebar-menu"
    data-sidebar="menu"
    className={cn('m-0 flex w-full min-w-0 list-none flex-col gap-1 p-0', className)}
    {...props}
  />
)
export const SidebarMenuItem = ({ className, ...props }: ComponentProps<'li'>) => (
  <li
    data-slot="sidebar-menu-item"
    data-sidebar="menu-item"
    className={cn('group/menu-item relative', className)}
    {...props}
  />
)

const menuButton = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md ' +
    'border-0 bg-transparent p-2 text-left font-[inherit] text-[15px] ' +
    'text-sidebar-foreground outline-none transition-colors ' +
    'duration-(--duration-state) ease-(--ease-out) hover:bg-muted ' +
    'focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    'group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! ' +
    'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium ' +
    'data-[state=open]:bg-muted [&>span:last-child]:truncate [&>svg]:shrink-0',
  {
    variants: { size: { default: 'h-9', lg: 'h-12 group-data-[collapsible=icon]:p-0!' } },
    defaultVariants: { size: 'default' },
  },
)

export function SidebarMenuButton({
  asChild,
  isActive,
  tooltip,
  size,
  className,
  ...props
}: ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean; tooltip?: string } & VariantProps<
    typeof menuButton
  >) {
  const Comp = asChild ? Slot : 'button'
  const { isMobile, state } = useSidebar()
  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-active={isActive ?? false}
      aria-current={isActive ? 'page' : undefined}
      className={cn(menuButton({ size }), className)}
      {...props}
    />
  )
  if (!tooltip || state !== 'collapsed' || isMobile) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export const SidebarMenuBadge = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="sidebar-menu-badge"
    data-sidebar="menu-badge"
    className={cn(
      'pointer-events-none absolute top-1/2 right-2 flex h-5 min-w-5 -translate-y-1/2 ' +
        'items-center justify-center rounded-sm bg-primary px-1 font-mono text-xs/4 ' +
        'font-medium text-primary-foreground select-none ' +
        'group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 ' +
        'group-data-[collapsible=icon]:size-2 group-data-[collapsible=icon]:min-w-0 ' +
        'group-data-[collapsible=icon]:translate-y-0 group-data-[collapsible=icon]:p-0 ' +
        'group-data-[collapsible=icon]:text-[0px]',
      className,
    )}
    {...props}
  />
)

export const SidebarMenuSub = ({ className, ...props }: ComponentProps<'ul'>) => (
  <ul
    data-slot="sidebar-menu-sub"
    data-sidebar="menu-sub"
    className={cn(
      'mx-3.5 my-0 flex min-w-0 translate-x-px list-none flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5',
      className,
    )}
    {...props}
  />
)
export const SidebarMenuSubItem = ({ className, ...props }: ComponentProps<'li'>) => (
  <li data-slot="sidebar-menu-sub-item" className={cn('relative', className)} {...props} />
)

export function SidebarMenuSubButton({
  asChild,
  isActive,
  className,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot : 'a'
  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-active={isActive ?? false}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-[15px] ' +
          'text-sidebar-foreground outline-none transition-colors ' +
          'duration-(--duration-state) ease-(--ease-out) hover:bg-muted ' +
          'focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
          'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium ' +
          '[&>span:last-child]:truncate',
        className,
      )}
      {...props}
    />
  )
}
