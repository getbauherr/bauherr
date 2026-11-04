import type { ReactNode } from 'react'
import Link from 'next/link'
import { TopBar } from '../components/TopBar'
import { loadOverview } from '../lib/overview'
import { countOwnDrafts } from '../lib/requests'
import { currentWorkspace } from '../lib/session'
import { appVersion } from '../lib/version'

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  const needsYou = workspace ? (await loadOverview(workspace.id, false)).tickets.filter((t) => t.needsYou).length : 0
  const drafts = workspace ? await countOwnDrafts(user.id as number, workspace.id) : 0
  return (
    <>
      <TopBar user={user} workspaces={workspaces} workspace={workspace} needsYou={needsYou} drafts={drafts} hasKnowledge={!!(workspace?.knowledgeRepo && workspace.knowledgeConnection)} />
      <main className="flex flex-col gap-6 p-8 max-sm:p-4 max-sm:has-[[data-testid=action-bar]]:pb-[calc(132px+var(--space-4))]">{children}</main>
      <footer className="small muted p-8 pt-0 max-sm:p-4">
        <Link href="/release-notes" data-testid="app-version">v{appVersion()}</Link>
      </footer>
    </>
  )
}
