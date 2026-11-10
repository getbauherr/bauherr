import type { ReactNode } from 'react'
import Link from 'next/link'
import { TopBar } from '../components/TopBar'
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
    <>
      <TopBar user={user} workspaces={workspaces} workspace={workspace} needsYou={needsYou} drafts={drafts} hasKnowledge={!!(workspace?.knowledgeRepo && workspace.knowledgeConnection)} />
      <main className="flex flex-col gap-6 p-8 max-sm:p-4 max-sm:has-[[data-testid=action-bar]]:pb-[calc(var(--next-step-h,132px)+var(--space-4))]">{children}</main>
      <footer className="small muted p-8 pt-0 max-sm:p-4">
        <Link href="/release-notes" data-testid="app-version">v{appVersion()}</Link>
      </footer>
    </>
  )
}
