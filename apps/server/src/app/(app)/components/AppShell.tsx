import type { ReactNode } from 'react'
import { AppFooter } from './AppFooter'
import { AppSidebar } from './AppSidebar'
import { mainItems } from './nav-items'
import { NavProgress } from './NavProgress'
import { PageTitleProvider } from './PageTitle'
import { PresenceProvider, type Presence } from './Presence'
import { ShellHeader } from './ShellHeader'
import { SidebarProvider } from './ui/sidebar'

type Props = Parameters<typeof AppSidebar>[0] & { defaultOpen: boolean; presence: Presence; version: string; dock?: ReactNode; children: ReactNode }

/** Shell: sidebar | content (header, main) | optional right dock. `dock` is the slot for the AI chat panel; without it nothing renders there. */
export function AppShell({ defaultOpen, presence, version, dock, children, ...sidebar }: Props) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <PageTitleProvider>
        <PresenceProvider initial={presence}>
          <NavProgress />
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
          <AppSidebar {...sidebar} />
          <div className="group/col flex min-w-0 flex-1 flex-col">
            <ShellHeader items={mainItems(sidebar).map(({ href, label }) => ({ href, label }))} admin={sidebar.admin} setup={sidebar.setup} logout={sidebar.logout} />
            <main id="main" tabIndex={-1} className="flex flex-col gap-6 p-8 outline-none max-sm:p-4">{children}</main>
            <AppFooter version={version} />
          </div>
          {dock}
        </PresenceProvider>
      </PageTitleProvider>
    </SidebarProvider>
  )
}
