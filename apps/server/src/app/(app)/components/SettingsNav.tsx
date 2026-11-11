'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LinkPending } from './LinkPending'
import { settingsGroups } from './nav-items'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSubButton } from './ui/sidebar'

/** Second-level Settings navigation by scope: a column with group headings beside the page (a scrolling row on phones) built from the sidebar's menu styles. */
export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname()
  const current = (href: string) => path === href || (['/settings/products', '/settings/templates'].includes(href) && path.startsWith(`${href}/`))
  return (
    <nav aria-label="Settings" className="flex flex-col gap-4 max-sm:flex-row max-sm:overflow-x-auto">
      {settingsGroups(admin).map((g) => (
        <div key={g.heading} role="group" aria-label={g.heading} className="flex flex-col gap-1 max-sm:shrink-0 max-sm:flex-row max-sm:items-center">
          <span className="label px-2 text-muted-foreground max-sm:hidden">{g.heading}</span>
          <SidebarMenu className="max-sm:flex-row">
            {g.entries.map(([label, href]) => (
              <SidebarMenuItem key={href} className="max-sm:shrink-0">
                <SidebarMenuSubButton asChild isActive={current(href)} className="h-9 max-sm:whitespace-nowrap">
                  <Link href={href}>{label}<LinkPending /></Link>
                </SidebarMenuSubButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      ))}
    </nav>
  )
}
