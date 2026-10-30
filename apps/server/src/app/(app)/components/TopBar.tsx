import Link from 'next/link'
import { logout, selectWorkspace } from '../lib/actions'
import type { Bauherr, Workspace } from '../lib/session'
import { ChevronDown, LogOut, Settings } from './icons'
import { Nav } from './Nav'
import { Popover } from './Popover'
import { ThemeToggle } from './ThemeToggle'

const initials = (email: string) => email.slice(0, 2).toUpperCase()

export function TopBar({ user, workspaces, workspace, needsYou }: { needsYou: number; user: Bauherr; workspaces: Workspace[]; workspace: Workspace | null }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect x="3" y="3" width="26" height="26" stroke="currentColor" strokeWidth="2" />
          <rect x="3" y="18" width="11" height="11" fill="var(--accent)" />
        </svg>
        <span className="heading">Bauherr</span>
      </Link>
      <Nav needsYou={needsYou} />
      <div className="tools">
        <Popover label={<>{workspace?.name ?? 'No Workspace'}<ChevronDown /></>}>
          {workspaces.map((w) => (
            <form key={w.slug} action={selectWorkspace.bind(null, w.slug)}>
              <button className="row" aria-current={w.slug === workspace?.slug}>{w.name}</button>
            </form>
          ))}
          <Link href="/settings/workspace" className="row sep"><Settings />Workspace settings</Link>
        </Popover>
        <ThemeToggle />
        <Popover label={<span className="avatar">{initials(user.email)}<span className="sr">User menu</span></span>}>
          <p className="small row muted">{user.email}</p>
          <Link href="/settings/bauherren" className="row">Bauherren</Link>
          <Link href="/settings/api-key" className="row">API key</Link>
          <form action={logout}>
            <button className="row sep"><LogOut />Sign out</button>
          </form>
        </Popover>
      </div>
    </header>
  )
}
