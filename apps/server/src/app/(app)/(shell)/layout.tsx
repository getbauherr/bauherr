import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { AppShell } from '../components/AppShell'
import { ChatDock } from '../components/chat/ChatDock'
import { SIDEBAR_COOKIE } from '../components/ui/sidebar-cookie'
import { logout, selectWorkspace } from '../lib/actions'
import { countOwnDrafts } from '../lib/requests'
import { currentWorkspace, payloadClient } from '../lib/session'
import { appVersion } from '../lib/version'

/** Open Tickets whose `needsYou` column (written by the gate sweep) is set, plus for an Admin the skill proposals that wait for a merge: indexed counts instead of the overview. */
const countNeedsYou = async (workspace: number, admin: boolean): Promise<number> => {
  const payload = await payloadClient()
  const [tickets, skills] = await Promise.all([
    payload.count({ collection: 'tickets', where: { workspace: { equals: workspace }, state: { equals: 'open' }, needsYou: { exists: true } }, overrideAccess: true }),
    admin ? payload.count({ collection: 'skill_proposals', where: { workspace: { equals: workspace }, status: { in: ['proposed', 'replayed'] }, pr: { exists: true } }, overrideAccess: true }) : { totalDocs: 0 },
  ])
  return tickets.totalDocs + skills.totalDocs
}

/** Setup is unfinished while the Workspace has no Ticket yet (an Admin's palette offers "Set up"). */
const needsSetup = async (workspace: number, admin: boolean): Promise<boolean> =>
  admin && (await (await payloadClient()).count({ collection: 'tickets', where: { workspace: { equals: workspace } }, overrideAccess: true })).totalDocs === 0

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  const [needsYou, drafts, setup] = workspace ? await Promise.all([countNeedsYou(workspace.id, user.role === 'admin'), countOwnDrafts(user.id as number, workspace.id), needsSetup(workspace.id, user.role === 'admin')]) : [0, 0, false]
  return (
    <AppShell
      defaultOpen={(await cookies()).get(SIDEBAR_COOKIE)?.value !== 'false'}
      email={user.email}
      admin={user.role === 'admin'}
      version={appVersion()}
      workspaces={workspaces.map(({ slug, name }) => ({ slug, name }))}
      current={workspace?.slug}
      setup={setup}
      needsYou={needsYou}
      drafts={drafts}
      hasKnowledge={!!(workspace?.knowledgeRepo && workspace.knowledgeConnection)}
      dock={<ChatDock userId={user.id} />}
      logout={logout}
      selectWorkspace={selectWorkspace}
    >
      {children}
    </AppShell>
  )
}
