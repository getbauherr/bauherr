import Link from 'next/link'
import { logout, selectWorkspace } from '../lib/actions'
import type { Bauherr, Workspace } from '../lib/session'
import { Nav } from './Nav'
import { UserMenu } from './UserMenu'
import { Button } from './ui/button'

export function TopBar({ user, workspaces, workspace, needsYou, hasKnowledge }: { needsYou: number; hasKnowledge: boolean; user: Bauherr; workspaces: Workspace[]; workspace: Workspace | null }) {
  return (
    <header className="topbar flex min-h-14 items-center gap-6 border-b border-border bg-card px-8 max-sm:flex-wrap max-sm:gap-x-4 max-sm:gap-y-0 max-sm:px-4 max-sm:py-2">
      <Link href="/" className="flex items-center gap-2">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect x="3" y="3" width="26" height="26" stroke="currentColor" strokeWidth="2" />
          <rect x="3" y="18" width="11" height="11" fill="var(--accent)" />
        </svg>
        <span className="heading">Bauherr</span>
      </Link>
      <Nav needsYou={needsYou} hasKnowledge={hasKnowledge} />
      <div className="ml-auto flex items-center gap-2">
        <Button asChild>
          <Link href="/requests/new">New request</Link>
        </Button>
        <UserMenu email={user.email} admin={user.role === 'admin'} workspaces={workspaces.map(({ slug, name }) => ({ slug, name }))} current={workspace?.slug} logout={logout} selectWorkspace={selectWorkspace} />
      </div>
    </header>
  )
}
