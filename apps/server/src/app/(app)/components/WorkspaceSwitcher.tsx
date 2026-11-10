'use client'
import { Check, ChevronsUpDown } from './icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { SidebarMenuButton, useSidebar } from './ui/sidebar'

const mark = (name: string) => <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-xs/4 font-medium group-data-[collapsible=icon]:size-7" aria-hidden>{name.slice(0, 2).toUpperCase()}</span>

/** Workspace of the Bauherr; with one Workspace its name, with several a menu that switches (server action, then back to the Tickets page). */
export function WorkspaceSwitcher({ workspaces, current, selectWorkspace }: { workspaces: { slug: string; name: string }[]; current?: string; selectWorkspace: (slug: string) => Promise<void> }) {
  const { isMobile } = useSidebar()
  const name = workspaces.find((w) => w.slug === current)?.name ?? 'No Workspace'
  if (workspaces.length < 2) {
    return (
      <div data-testid="workspace-name" className="flex h-12 items-center gap-2 overflow-hidden rounded-md p-2 group-data-[collapsible=icon]:p-0" title={name}>
        {mark(name)}
        <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">{name}</span>
      </div>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={name} aria-label="Workspace" data-testid="workspace-switcher">
          {mark(name)}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <ChevronsUpDown className="group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="start" className="w-64">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <form key={w.slug} action={selectWorkspace.bind(null, w.slug)}>
            <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
              <button aria-current={w.slug === current}>{w.name}{w.slug === current && <Check />}</button>
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
