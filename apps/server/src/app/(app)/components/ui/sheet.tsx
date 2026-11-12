'use client'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'
import { DialogOverlay } from './dialog'
import { cn } from '@/lib/utils'

export const Sheet = SheetPrimitive.Root
export const SheetTitle = SheetPrimitive.Title
export const SheetDescription = SheetPrimitive.Description

export function SheetContent({ className, children, side = 'left', ...props }: ComponentProps<typeof SheetPrimitive.Content> & { side?: 'left' | 'right' | 'bottom' }) {
  return (
    <SheetPrimitive.Portal>
      <DialogOverlay />
      <SheetPrimitive.Content data-slot="sheet-content" className={cn('fixed z-50 flex flex-col gap-4 border-border bg-popover text-popover-foreground', side === 'bottom' ? 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t' : cn('inset-y-0 h-full w-3/4 sm:max-w-sm', side === 'left' ? 'left-0 border-r' : 'right-0 border-l'), className)} {...props}>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

export const SheetHeader = ({ className, ...props }: ComponentProps<'div'>) => <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />
