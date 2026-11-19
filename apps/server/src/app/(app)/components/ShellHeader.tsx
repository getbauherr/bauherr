'use client'
import { Breadcrumbs } from './Breadcrumbs'
import { CommandMenu } from './CommandMenu'
import type { NavItem } from './nav-items'
import { Separator } from './ui/separator'
import { SidebarTrigger } from './ui/sidebar'

export function ShellHeader({ items, admin, logout }: { items: Pick<NavItem, 'href' | 'label'>[]; admin: boolean; logout: () => Promise<void> }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 max-sm:gap-1 max-sm:px-2">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5 max-sm:hidden" />
      <Breadcrumbs />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <CommandMenu items={items} admin={admin} logout={logout} />
      </div>
    </header>
  )
}
