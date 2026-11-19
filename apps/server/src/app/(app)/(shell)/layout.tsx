import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { isProductOwner } from '../../../lib/people'
import { AppShell } from '../components/AppShell'
import { SIDEBAR_COOKIE } from '../components/ui/sidebar-cookie'
import { logout, selectWorkspace } from '../lib/actions'
import { currentPersonWorkspace } from '../lib/session'
import { appVersion } from '../lib/version'

export default async function Layout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await currentPersonWorkspace()
  return (
    <AppShell
      defaultOpen={(await cookies()).get(SIDEBAR_COOKIE)?.value !== 'false'}
      email={user.email}
      admin={user.role === 'admin'}
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
