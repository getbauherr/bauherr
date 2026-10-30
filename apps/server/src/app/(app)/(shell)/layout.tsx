import type { ReactNode } from 'react'
import { TopBar } from '../components/TopBar'
import { currentWorkspace } from '../lib/session'

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  return (
    <>
      <TopBar user={user} workspaces={workspaces} workspace={workspace} />
      <main className="page">{children}</main>
    </>
  )
}
