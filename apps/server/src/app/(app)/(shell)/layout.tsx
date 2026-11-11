import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { AppShell } from '../components/AppShell'
import { ChatDock } from '../components/chat/ChatDock'
import { SIDEBAR_COOKIE } from '../components/ui/sidebar-cookie'
import { logout, selectWorkspace } from '../lib/actions'
import { countOwnDrafts } from '../lib/requests'
import { currentWorkspace, payloadClient } from '../lib/session'
import { isAdmin } from '../lib/settings'
import { loadSetup, SETUP_STEPS } from '../lib/setup'
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

/** The sidebar chip only matters until the first Ticket exists, so a Workspace with one pays a single indexed lookup instead of the setup queries. */
const setupOf = async (workspace: number) => {
  const first = await (await payloadClient()).find({ collection: 'tickets', where: { workspace: { equals: workspace } }, limit: 1, pagination: false, depth: 0, select: {}, overrideAccess: true })
  if (first.docs.length) return { done: SETUP_STEPS.length, total: SETUP_STEPS.length, complete: true }
  const s = await loadSetup(workspace)
  return { done: s.count, total: SETUP_STEPS.length, complete: s.complete }
}

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentWorkspace()
  const [needsYou, drafts, setup] = workspace ? await Promise.all([countNeedsYou(workspace.id, user.role === 'admin'), countOwnDrafts(user.id as number, workspace.id), isAdmin(user) ? setupOf(workspace.id) : undefined]) : [0, 0, undefined]
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
      setup={setup}
      hasKnowledge={!!(workspace?.knowledgeRepo && workspace.knowledgeConnection)}
      dock={<ChatDock userId={user.id} />}
      logout={logout}
      selectWorkspace={selectWorkspace}
    >
      {children}
    </AppShell>
  )
}
