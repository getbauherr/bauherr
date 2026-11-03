'use client'
import Link from 'next/link'
import { LogOut, Settings } from './icons'
import { ThemeRow } from './ThemeToggle'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

const initials = (email: string) => email.slice(0, 2).toUpperCase()

/** Client component: Radix `asChild` items cannot take server-rendered children (React 19 lazy elements). */
export function UserMenu({ email, admin, workspaces, current, logout, selectWorkspace }: { email: string; admin: boolean; workspaces: { slug: string; name: string }[]; current?: string; logout: () => Promise<void>; selectWorkspace: (slug: string) => Promise<void> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="px-2">
          <span className="avatar">{initials(email)}<span className="sr">User menu</span></span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        {workspaces.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            {workspaces.map((w) => (
              <form key={w.slug} action={selectWorkspace.bind(null, w.slug)}>
                <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                  <button aria-current={w.slug === current}>{w.name}</button>
                </DropdownMenuItem>
              </form>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <ThemeRow />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={admin ? '/settings' : '/settings/api-key'}><Settings />Settings</Link>
        </DropdownMenuItem>
        <form action={logout}>
          <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
            <button><LogOut />Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
