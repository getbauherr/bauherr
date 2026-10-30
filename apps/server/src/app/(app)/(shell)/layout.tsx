import type { ReactNode } from 'react'
import { TopBar } from '../components/TopBar'
import { loadOverview } from '../lib/overview'
import { currentWorkspace } from '../lib/session'

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  const needsYou = workspace ? (await loadOverview(workspace.id, false)).tickets.filter((t) => t.needsYou).length : 0
  return (
    <>
      <TopBar user={user} workspaces={workspaces} workspace={workspace} needsYou={needsYou} />
      <main className="page">{children}</main>
    </>
  )
}
