'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { LinkPending } from './LinkPending'
import { mainItems, settingsItem, type NavItem } from './nav-items'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from './ui/sidebar'
import { UserMenu } from './UserMenu'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

type Props = {
  email: string
  admin: boolean
  productOwner: boolean
  waitingOnYou: number
  workspaces: { slug: string; name: string }[]
  current?: string
  logout: () => Promise<void>
  selectWorkspace: (slug: string) => Promise<void>
}

type CountProps = { count: number; title: string; note: string }

function NavCount({ count, title, note }: Partial<CountProps>) {
  if (!count || count <= 0) return null
  return (
    <span
      className={
        'ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs/5 font-semibold ' +
        'text-primary-foreground group-data-[collapsible=icon]:hidden'
      }
      title={title}
    >
      {count}
      <span className="sr-only">{note}</span>
    </span>
  )
}

function Brand() {
  return (
    <Link
      href="/"
      aria-label="Bauherr"
      className={
        'flex h-9 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-sidebar-ring'
      }
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
        <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="2" />
        <rect x="12" y="12" width="10" height="10" rx="2" fill="var(--accent)" />
      </svg>
      <span className="heading font-bold group-data-[collapsible=icon]:hidden">Bauherr</span>
    </Link>
  )
}

export function AppSidebar(props: Props) {
  const { email, admin, productOwner, waitingOnYou, workspaces, current, logout, selectWorkspace } = props
  const path = usePathname()
  const { setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(false), [path, setOpenMobile])
  const counts: Record<string, CountProps> = {
    '/inbox': { count: waitingOnYou, title: 'Waiting on you', note: ' waiting on you' },
  }
  const item = ({ href, label, Icon, match }: NavItem) => (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton asChild isActive={match(path)} tooltip={label}>
        <Link href={href}>
          <Icon />
          <span>{label}</span>
          <NavCount {...counts[href]} />
          <LinkPending />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
  return (
    <Sidebar>
      <SidebarHeader>
        <Brand />
        {!productOwner && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            current={current}
            admin={admin}
            selectWorkspace={selectWorkspace}
          />
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label="Main">
            <SidebarMenu>{mainItems(productOwner).map(item)}</SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {!productOwner && (
          <nav aria-label="Account">
            <SidebarMenu>{item(settingsItem())}</SidebarMenu>
          </nav>
        )}
        <UserMenu email={email} logout={logout} />
      </SidebarFooter>
    </Sidebar>
  )
}
