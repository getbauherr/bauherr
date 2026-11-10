'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LinkPending } from './LinkPending'
import { settingsAdvanced, settingsOwner } from './nav-items'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSubButton } from './ui/sidebar'

type Entry = [label: string, href: string]

/** Second-level Settings navigation: a column beside the page (a scrolling row on phones) built from the sidebar's menu styles. */
export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname()
  const current = (href: string) => path === href || (href === '/settings/products' && path.startsWith(`${href}/`))
  const link = ([label, href]: Entry, nested?: boolean) => (
    <SidebarMenuItem key={href} className={nested ? 'max-sm:inline-block' : 'max-sm:shrink-0'}>
      <SidebarMenuSubButton asChild isActive={current(href)} className="h-9 max-sm:whitespace-nowrap">
        <Link href={href}>{label}<LinkPending /></Link>
      </SidebarMenuSubButton>
    </SidebarMenuItem>
  )
  return (
    <nav aria-label="Settings" className="max-sm:overflow-x-auto">
      <SidebarMenu className="max-sm:flex-row">
        {settingsOwner.map((e) => link(e))}
        {!admin && link(['API key', '/settings/api-key'])}
        {admin && (
          <li className="max-sm:shrink-0">
            <details className="group block max-sm:w-max max-sm:whitespace-nowrap" open={settingsAdvanced.some(([, href]) => current(href)) || undefined}>
              <summary className="flex h-9 max-sm:inline-flex cursor-pointer items-center rounded-md px-2 text-[15px] text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring group-open:text-foreground max-sm:whitespace-nowrap">Advanced</summary>
              <ul className="mt-1 flex flex-col gap-1 pl-3 max-sm:mt-0 max-sm:inline-block max-sm:pl-1">{settingsAdvanced.map((e) => link(e, true))}</ul>
            </details>
          </li>
        )}
      </SidebarMenu>
    </nav>
  )
}
