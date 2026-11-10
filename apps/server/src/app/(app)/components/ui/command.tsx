'use client'
import { Command as CommandPrimitive } from 'cmdk'
import type { ComponentProps, ReactNode } from 'react'
import { Search } from '../icons'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog'
import { cn } from '@/lib/utils'

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive data-slot="command" className={cn('flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground', className)} {...props} />
}

export function CommandDialog({ title = 'Command palette', description = 'Search for a page, a Ticket or an action.', children, trigger, ...props }: ComponentProps<typeof Dialog> & { title?: string; description?: string; trigger?: ReactNode }) {
  return (
    <Dialog {...props}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command shouldFilter={false}>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-12 items-center gap-2 border-b border-border px-3 text-muted-foreground">
      <Search />
      <CommandPrimitive.Input data-slot="command-input" className={cn('h-full w-full bg-transparent text-[15px] text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground', className)} {...props} />
    </div>
  )
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn('max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto', className)} {...props} />
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="py-6 text-center text-[15px] text-muted-foreground" {...props} />
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group data-slot="command-group" className={cn('overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item data-slot="command-item" className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[15px] outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:shrink-0 [&_svg]:text-muted-foreground", className)} {...props} />
}

export const CommandShortcut = ({ className, ...props }: ComponentProps<'span'>) => <span data-slot="command-shortcut" className={cn('mono ml-auto text-muted-foreground', className)} {...props} />
