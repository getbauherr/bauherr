'use client'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn('z-50 min-w-52 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover py-1 text-[15px] text-popover-foreground', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn("flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-inherit outline-none select-none data-[highlighted]:bg-secondary data-[disabled]:opacity-50 aria-[current=true]:bg-accent aria-pressed:bg-accent [&_svg]:shrink-0", className)}
      {...props}
    />
  )
}

export function DropdownMenuRadioItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn('flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1 outline-none select-none data-[highlighted]:bg-secondary data-[state=checked]:border-border data-[state=checked]:bg-accent [&_svg]:shrink-0', className)}
      {...props}
    />
  )
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" className={cn('px-3 py-2 text-[13px] text-muted-foreground', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn('my-1 h-px bg-border', className)} {...props} />
}
