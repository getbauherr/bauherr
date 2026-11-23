import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { isProductOwner } from '../../../lib/people'
import { newMemoryCount } from '../../../core/views/statement-records'
import { waitingOnOwner } from '../../../core/views/owner'
import { AppShell } from '../components/AppShell'
import { SIDEBAR_COOKIE } from '../components/ui/sidebar-cookie'
import { logout, selectWorkspace } from '../lib/actions'
import { currentPersonWorkspace, payloadClient } from '../lib/session'
import { appVersion } from '../lib/version'

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentPersonWorkspace()
  const counted = workspace && !isProductOwner(user)
  const waitingOnYou = counted ? await waitingOnOwner(await payloadClient(), workspace.id) : 0
  const newMemories = workspace ? await newMemoryCount(await payloadClient(), workspace.id) : 0
  return (
    <AppShell
      defaultOpen={(await cookies()).get(SIDEBAR_COOKIE)?.value !== 'false'}
      email={user.email}
      admin={user.role === 'admin'}
      waitingOnYou={waitingOnYou}
      newMemories={newMemories}
      workspaces={isProductOwner(user) ? [] : workspaces.map(({ slug, name }) => ({ slug, name }))}
      current={workspace?.slug}
      version={appVersion()}
      logout={logout}
      selectWorkspace={selectWorkspace}
    >
      {children}
    </AppShell>
  )
}
