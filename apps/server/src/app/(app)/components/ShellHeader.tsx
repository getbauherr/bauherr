'use client'
import { usePathname } from 'next/navigation'
import { Breadcrumbs } from './Breadcrumbs'
import { ChatButton } from './chat/ChatButton'
import { RequestOpen } from './chat/DockOpen'
import { CommandMenu } from './CommandMenu'
import { Plus } from './icons'
import { PresencePill } from './Presence'
import type { NavItem } from './nav-items'
import { Separator } from './ui/separator'
import { SidebarTrigger } from './ui/sidebar'

/** Slim row above the page: sidebar trigger, breadcrumb, then the two actions that are the same on every page. */
export function ShellHeader({ items, admin, setup, minimal, logout }: { items: Pick<NavItem, 'href' | 'label'>[]; admin: boolean; setup?: { complete: boolean }; minimal?: boolean; logout: () => Promise<void> }) {
  const path = usePathname()
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 max-sm:gap-1 max-sm:px-2">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5 max-sm:hidden" />
      <Breadcrumbs />
      {!minimal && <div className="ml-auto flex shrink-0 items-center gap-2">
        {!path.startsWith('/requests/new') && (
          <RequestOpen request="new" variant="outline" className="max-sm:size-9 max-sm:px-0">
            <Plus />
            <span className="max-sm:sr-only">New request</span>
          </RequestOpen>
        )}
        <PresencePill />
        <CommandMenu items={items} admin={admin} setup={setup} logout={logout} />
        <ChatButton />
      </div>}
    </header>
  )
}
