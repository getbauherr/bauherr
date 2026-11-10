'use client'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({ className, sideOffset = 6, align = 'start', ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content data-slot="popover-content" sideOffset={sideOffset} align={align} className={cn('aui-root z-50 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-[14px] text-popover-foreground', className)} {...props} />
    </PopoverPrimitive.Portal>
  )
}
