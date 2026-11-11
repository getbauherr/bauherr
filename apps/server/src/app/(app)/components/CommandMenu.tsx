'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { request } from './chat/dock-state'
import { Chat } from './chat/icons'
import { LogOut, Moon, Plus, Search, Ticket } from './icons'
import { settingsPages, type NavItem } from './nav-items'
import { toggleTheme } from './ThemeToggle'
import { Button } from './ui/button'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { searchTickets, type TicketHit } from '../lib/search'

const SEARCH_DEBOUNCE_MS = 150

/** Header search button plus the command palette it and Ctrl/Cmd+K open: pages, Tickets of the Workspace (searched on the server while typing), actions. */
export function CommandMenu({ items, admin, setup, logout }: { items: Pick<NavItem, 'href' | 'label'>[]; admin: boolean; setup?: { complete: boolean }; logout: () => Promise<void> }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<TicketHit[]>([])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const term = q.trim()
    if (!term) return setHits([])
    let stale = false
    const id = setTimeout(() => searchTickets(term).then((r) => !stale && setHits(r)), SEARCH_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(id)
    }
  }, [q])
  const run = (action: () => void) => {
    setOpen(false)
    action()
  }
  const go = (href: string) => run(() => router.push(href))
  const needle = q.trim().toLowerCase()
  const pages = [...items.map(({ href, label }) => ({ href, label })), ...(setup ? [{ href: '/setup', label: setup.complete ? 'Setup checklist' : 'Set up' }] : []), ...settingsPages(admin).map(([label, href]) => ({ href, label: `Settings: ${label}` }))].filter((p) => p.label.toLowerCase().includes(needle))
  const actions = [
    { label: 'Ask the factory', Icon: Chat, run: () => run(() => request('focus')) },
    { label: 'New chat', Icon: Chat, run: () => run(() => request('new')) },
    { label: 'New request', Icon: Plus, run: () => run(() => request({ request: 'new' })) },
    { label: 'Toggle theme', Icon: Moon, run: () => run(toggleTheme) },
    { label: 'Sign out', Icon: LogOut, run: () => run(() => void logout()) },
  ].filter((a) => a.label.toLowerCase().includes(needle))
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
      trigger={
        <Button variant="outline" aria-label="Command palette" aria-keyshortcuts="Control+K Meta+K" className="gap-2 text-muted-foreground max-sm:size-9 max-sm:px-0">
          <Search />
          <span className="max-sm:hidden">Search</span>
          <kbd className="mono rounded-sm border border-border px-1 max-sm:hidden">⌘K</kbd>
        </Button>
      }
    >
      <CommandInput value={q} onValueChange={setQ} placeholder="Go to a page, find a Ticket (#123 or words), run an action" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        {pages.length > 0 && (
          <CommandGroup heading="Go to">
            {pages.map((p) => (
              <CommandItem key={p.href + p.label} value={p.href + p.label} onSelect={() => go(p.href)}>{p.label}</CommandItem>
            ))}
          </CommandGroup>
        )}
        {hits.length > 0 && (
          <CommandGroup heading="Tickets">
            {hits.map((t) => (
              <CommandItem key={t.id} value={`ticket-${t.id}`} onSelect={() => go(`/tickets/${t.id}`)}>
                <Ticket />
                <span className="mono">#{t.number}</span>
                <span className="truncate">{t.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.label} value={`action-${a.label}`} onSelect={a.run}>
                <a.Icon />
                {a.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
