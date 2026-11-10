'use client'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentProps, type CSSProperties } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { PanelLeft } from '../icons'
import { Button } from './button'
import { SIDEBAR_COOKIE } from './sidebar-cookie'
import { Separator } from './separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const SIDEBAR_WIDTH = '14rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'
const SIDEBAR_WIDTH_ICON = '3.25rem'

type SidebarContext = { state: 'expanded' | 'collapsed'; open: boolean; setOpen: (open: boolean) => void; openMobile: boolean; setOpenMobile: (open: boolean) => void; isMobile: boolean; toggleSidebar: () => void }

const Context = createContext<SidebarContext | null>(null)

export function useSidebar(): SidebarContext {
  const context = useContext(Context)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.')
  return context
}

export function SidebarProvider({ defaultOpen = true, className, style, children, ...props }: ComponentProps<'div'> & { defaultOpen?: boolean }) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = useState(false)
  const [open, setOpenState] = useState(defaultOpen)
  const setOpen = useCallback((value: boolean) => {
    setOpenState(value)
    document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
  }, [])
  const toggleSidebar = useCallback(() => (isMobile ? setOpenMobile((o) => !o) : setOpen(!open)), [isMobile, open, setOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [toggleSidebar])
  const value = useMemo<SidebarContext>(() => ({ state: open ? 'expanded' : 'collapsed', open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }), [open, setOpen, isMobile, openMobile, toggleSidebar])
  return (
    <Context.Provider value={value}>
      <TooltipProvider delayDuration={0}>
        <div data-slot="sidebar-wrapper" style={{ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_WIDTH_ICON, ...style } as CSSProperties} className={cn('flex min-h-svh w-full', className)} {...props}>
          {children}
        </div>
      </TooltipProvider>
    </Context.Provider>
  )
}

/** Left sidebar that collapses to an icon rail; a Sheet below 768px. */
export function Sidebar({ className, children, ...props }: ComponentProps<'div'>) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent data-sidebar="sidebar" data-slot="sidebar" data-mobile="true" className="w-(--sidebar-width) gap-0 bg-sidebar p-0 text-sidebar-foreground" style={{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE } as CSSProperties}>
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Navigation</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <div className="group peer hidden text-sidebar-foreground md:block" data-state={state} data-collapsible={state === 'collapsed' ? 'icon' : ''} data-slot="sidebar">
      <div data-slot="sidebar-gap" className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-(--duration-panel) ease-(--ease-out) group-data-[collapsible=icon]:w-(--sidebar-width-icon)" />
      <div data-slot="sidebar-container" className={cn('fixed inset-y-0 left-0 z-10 flex h-svh w-(--sidebar-width) border-r border-sidebar-border transition-[width] duration-(--duration-panel) ease-(--ease-out) group-data-[collapsible=icon]:w-(--sidebar-width-icon)', className)} {...props}>
        <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex h-full w-full flex-col overflow-hidden bg-sidebar">
          {children}
        </div>
      </div>
    </div>
  )
}

export function SidebarTrigger({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()
  return (
    <Button data-sidebar="trigger" data-slot="sidebar-trigger" variant="ghost" size="icon" className={cn('size-8', className)} onClick={(e) => { onClick?.(e); toggleSidebar() }} {...props}>
      <PanelLeft />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  )
}

export const SidebarHeader = ({ className, ...props }: ComponentProps<'div'>) => <div data-slot="sidebar-header" data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
export const SidebarFooter = ({ className, ...props }: ComponentProps<'div'>) => <div data-slot="sidebar-footer" data-sidebar="footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
export const SidebarSeparator = ({ className, ...props }: ComponentProps<typeof Separator>) => <Separator data-slot="sidebar-separator" className={cn('mx-2 w-auto bg-sidebar-border', className)} {...props} />
export const SidebarContent = ({ className, ...props }: ComponentProps<'div'>) => <div data-slot="sidebar-content" data-sidebar="content" className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden', className)} {...props} />
export const SidebarGroup = ({ className, ...props }: ComponentProps<'div'>) => <div data-slot="sidebar-group" data-sidebar="group" className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />
export const SidebarMenu = ({ className, ...props }: ComponentProps<'ul'>) => <ul data-slot="sidebar-menu" data-sidebar="menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
export const SidebarMenuItem = ({ className, ...props }: ComponentProps<'li'>) => <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cn('group/menu-item relative', className)} {...props} />

const menuButton = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-[15px] text-sidebar-foreground outline-none transition-colors duration-(--duration-state) ease-(--ease-out) hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2! data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[state=open]:bg-muted [&>span:last-child]:truncate [&>svg]:shrink-0",
  { variants: { size: { default: 'h-9', lg: 'h-12 group-data-[collapsible=icon]:p-0!' } }, defaultVariants: { size: 'default' } },
)

/** `tooltip` shows only on the collapsed rail. */
export function SidebarMenuButton({ asChild, isActive, tooltip, size, className, ...props }: ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean; tooltip?: string } & VariantProps<typeof menuButton>) {
  const Comp = asChild ? Slot : 'button'
  const { isMobile, state } = useSidebar()
  const button = <Comp data-slot="sidebar-menu-button" data-sidebar="menu-button" data-active={isActive ?? false} aria-current={isActive ? 'page' : undefined} className={cn(menuButton({ size }), className)} {...props} />
  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== 'collapsed' || isMobile}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export const SidebarMenuBadge = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="sidebar-menu-badge" data-sidebar="menu-badge" className={cn('pointer-events-none absolute top-1/2 right-2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-sm bg-primary px-1 font-mono text-xs/4 font-medium text-primary-foreground select-none group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:size-2 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:translate-y-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-[0px]', className)} {...props} />
)

export const SidebarMenuSub = ({ className, ...props }: ComponentProps<'ul'>) => <ul data-slot="sidebar-menu-sub" data-sidebar="menu-sub" className={cn('mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5', className)} {...props} />
export const SidebarMenuSubItem = ({ className, ...props }: ComponentProps<'li'>) => <li data-slot="sidebar-menu-sub-item" className={cn('relative', className)} {...props} />

export function SidebarMenuSubButton({ asChild, isActive, className, ...props }: ComponentProps<'a'> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot : 'a'
  return <Comp data-slot="sidebar-menu-sub-button" data-active={isActive ?? false} aria-current={isActive ? 'page' : undefined} className={cn('flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-[15px] text-sidebar-foreground outline-none transition-colors duration-(--duration-state) ease-(--ease-out) hover:bg-muted focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium [&>span:last-child]:truncate', className)} {...props} />
}
