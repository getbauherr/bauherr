import type { ReactNode } from 'react'
import Link from 'next/link'
import { TopBar } from '../components/TopBar'
import { loadOverviewRows } from '../lib/overview'
import { countOwnDrafts } from '../lib/requests'
import { currentWorkspace } from '../lib/session'
import { appVersion } from '../lib/version'

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  const [overview, drafts] = workspace ? await Promise.all([loadOverviewRows(workspace.id, false), countOwnDrafts(user.id as number, workspace.id)]) : [null, 0]
  const needsYou = overview?.tickets.filter((t) => t.needsYou).length ?? 0
  return (
    <>
      <TopBar user={user} workspaces={workspaces} workspace={workspace} needsYou={needsYou} drafts={drafts} hasKnowledge={!!(workspace?.knowledgeRepo && workspace.knowledgeConnection)} />
      <main className="flex flex-col gap-6 p-8 max-sm:p-4 max-sm:has-[[data-testid=action-bar]]:pb-[calc(var(--next-step-h,132px)+var(--space-4))]">{children}</main>
      <footer className="small muted p-8 pt-0 max-sm:p-4">
        <Link href="/release-notes" data-testid="app-version">v{appVersion()}</Link>
      </footer>
    </>
  )
}
