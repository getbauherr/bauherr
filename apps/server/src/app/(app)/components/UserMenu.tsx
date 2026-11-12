'use client'
import Link from 'next/link'
import { ChevronsUpDown, FileText, LogOut } from './icons'
import { LinkPending } from './LinkPending'
import { ThemeRow } from './ThemeToggle'
import { Avatar, AvatarFallback } from './ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { SidebarMenuButton, useSidebar } from './ui/sidebar'

const initials = (email: string) => email.slice(0, 2).toUpperCase()

/** Client component: Radix `asChild` items cannot take server-rendered children (React 19 lazy elements). */
export function UserMenu({ email, logout, minimal }: { email: string; logout: () => Promise<void>; minimal?: boolean }) {
  const { isMobile } = useSidebar()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={email} aria-label="User menu">
          <Avatar className="size-8"><AvatarFallback>{initials(email)}</AvatarFallback></Avatar>
          <span className="min-w-0 flex-1 truncate">{email}</span>
          <ChevronsUpDown className="group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="w-72">
        <DropdownMenuLabel className="truncate" title={email}>{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeRow />
        <DropdownMenuSeparator />
        {!minimal && (
          <DropdownMenuItem asChild>
            <Link href="/release-notes"><FileText />Release notes<LinkPending /></Link>
          </DropdownMenuItem>
        )}
        <form action={logout}>
          <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
            <button><LogOut />Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
