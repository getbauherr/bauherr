'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { LinkPending } from './LinkPending'
import { PresenceDot } from './Presence'
import { mainItems, settingsItem, type NavItem } from './nav-items'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, useSidebar } from './ui/sidebar'
import { UserMenu } from './UserMenu'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

type Props = { email: string; admin: boolean; workspaces: { slug: string; name: string }[]; current?: string; needsYou: number; drafts: number; setup?: { done: number; total: number; complete: boolean }; hasKnowledge: boolean; minimal?: boolean; logout: () => Promise<void>; selectWorkspace: (slug: string) => Promise<void> }

export function AppSidebar({ email, admin, workspaces, current, needsYou, drafts, setup, hasKnowledge, minimal, logout, selectWorkspace }: Props) {
  const path = usePathname()
  const { setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(false), [path, setOpenMobile])
  const badge = (href: string) => (href === '/inbox' ? { n: needsYou, noun: 'need you' } : href === '/requests' ? { n: drafts, noun: drafts === 1 ? 'draft' : 'drafts' } : { n: 0, noun: '' })
  const item = ({ href, label, Icon, match }: NavItem) => {
    const { n, noun } = badge(href)
    return (
      <SidebarMenuItem key={href}>
        <SidebarMenuButton asChild isActive={match(path)} tooltip={label}>
          <Link href={href}>
            <Icon />
            <span>{label}</span>
            {href === '/team' && <PresenceDot />}
            {n > 0 && <SidebarMenuBadge aria-label={`${n} ${noun}`}>{n}</SidebarMenuBadge>}
            <LinkPending />
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }
  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex h-9 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
            <rect x="3" y="3" width="26" height="26" stroke="currentColor" strokeWidth="2" />
            <rect x="3" y="18" width="11" height="11" fill="var(--accent)" />
          </svg>
          <span className="heading group-data-[collapsible=icon]:hidden">Bauherr</span>
        </Link>
        {!minimal && <WorkspaceSwitcher workspaces={workspaces} current={current} admin={admin} selectWorkspace={selectWorkspace} />}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label="Main">
            <SidebarMenu>{(minimal ? [settingsItem('Profile')] : mainItems({ hasKnowledge, admin })).map(item)}</SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {setup && !setup.complete && (
          <Link href="/setup" className="small flex h-8 items-center justify-between gap-2 rounded-md border border-border px-2 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden">
            <span>Setup {setup.done}/{setup.total}</span>
            <span className="text-primary">Continue</span>
            <LinkPending />
          </Link>
        )}
        {!minimal && (
          <nav aria-label="Account">
            <SidebarMenu>{item(settingsItem())}</SidebarMenu>
          </nav>
        )}
        <UserMenu email={email} logout={logout} minimal={minimal} />
      </SidebarFooter>
    </Sidebar>
  )
}
