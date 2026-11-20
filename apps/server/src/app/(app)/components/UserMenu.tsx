'use client'
import { ChevronsUpDown, LogOut } from './icons'
import { ThemeRow } from './ThemeToggle'
import { Avatar, AvatarFallback } from './ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { SidebarMenuButton, useSidebar } from './ui/sidebar'

const initials = (email: string) => email.slice(0, 2).toUpperCase()

export function UserMenu({ email, logout }: { email: string; logout: () => Promise<void> }) {
  const { isMobile } = useSidebar()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={email} aria-label={`User menu, ${email}`}>
          <Avatar className="size-8">
            <AvatarFallback data-mark={initials(email)} className="after:content-[attr(data-mark)]" />
          </Avatar>
          <span className="min-w-0 flex-1 truncate">{email}</span>
          <ChevronsUpDown className="group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="w-72">
        <DropdownMenuLabel className="truncate" title={email}>
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeRow />
        <DropdownMenuSeparator />
        <form action={logout}>
          <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
            <button>
              <LogOut />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
