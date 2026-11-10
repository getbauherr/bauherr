'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Breadcrumbs } from './Breadcrumbs'
import { CommandMenu } from './CommandMenu'
import { Plus } from './icons'
import { LinkPending } from './LinkPending'
import type { NavItem } from './nav-items'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { SidebarTrigger } from './ui/sidebar'

/** Slim row above the page: sidebar trigger, breadcrumb, then the two actions that are the same on every page. */
export function ShellHeader({ items, admin, logout }: { items: Pick<NavItem, 'href' | 'label'>[]; admin: boolean; logout: () => Promise<void> }) {
  const path = usePathname()
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 max-sm:gap-1 max-sm:px-2">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-5 max-sm:hidden" />
      <Breadcrumbs />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!path.startsWith('/requests/new') && (
          <Button asChild variant="outline" className="max-sm:size-9 max-sm:px-0">
            <Link href="/requests/new">
              <Plus />
              <span className="max-sm:sr-only">New request</span>
              <LinkPending />
            </Link>
          </Button>
        )}
        <CommandMenu items={items} admin={admin} logout={logout} />
      </div>
    </header>
  )
}
