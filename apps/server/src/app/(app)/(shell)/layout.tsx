import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { AppShell } from '../components/AppShell'
import { SIDEBAR_COOKIE } from '../components/ui/sidebar-cookie'
import { logout, selectWorkspace } from '../lib/actions'
import { countOwnDrafts } from '../lib/requests'
import { currentWorkspace, payloadClient } from '../lib/session'
import { appVersion } from '../lib/version'

/** Open Tickets whose `needsYou` column (written by the gate sweep) is set: one indexed count instead of the overview. */
const countNeedsYou = async (workspace: number): Promise<number> =>
  (await (await payloadClient()).count({ collection: 'tickets', where: { workspace: { equals: workspace }, state: { equals: 'open' }, needsYou: { exists: true } }, overrideAccess: true })).totalDocs

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  const [needsYou, drafts] = workspace ? await Promise.all([countNeedsYou(workspace.id), countOwnDrafts(user.id as number, workspace.id)]) : [0, 0]
  return (
    <AppShell
      defaultOpen={(await cookies()).get(SIDEBAR_COOKIE)?.value !== 'false'}
      email={user.email}
      admin={user.role === 'admin'}
      version={appVersion()}
      workspaces={workspaces.map(({ slug, name }) => ({ slug, name }))}
      current={workspace?.slug}
      needsYou={needsYou}
      drafts={drafts}
      hasKnowledge={!!(workspace?.knowledgeRepo && workspace.knowledgeConnection)}
      logout={logout}
      selectWorkspace={selectWorkspace}
    >
      {children}
    </AppShell>
  )
}
