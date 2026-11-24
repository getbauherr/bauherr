'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { LogOut, Moon, Search } from './icons'
import { settingsPages, type NavItem } from './nav-items'
import { toggleTheme } from './ThemeToggle'
import { Button } from './ui/button'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'

const paletteTrigger = (
  <Button
    variant="outline"
    aria-label="Search ⌘K, command palette"
    aria-keyshortcuts="Control+K Meta+K"
    className="gap-2 text-muted-foreground max-sm:size-9 max-sm:px-0"
  >
    <Search />
    <span className="max-sm:hidden">Search</span>
    <kbd aria-hidden className="mono rounded-sm border border-border px-1 max-sm:hidden">
      ⌘K
    </kbd>
  </Button>
)

type Page = { href: string; label: string }
type Action = { label: string; Icon: (props: { className?: string }) => ReactNode; run: () => void }

function PageGroup({ pages, go }: { pages: Page[]; go: (href: string) => void }) {
  return pages.length > 0 ? (
    <CommandGroup heading="Go to">
      {pages.map((p) => (
        <CommandItem key={p.href + p.label} value={p.href + p.label} onSelect={() => go(p.href)}>
          {p.label}
        </CommandItem>
      ))}
    </CommandGroup>
  ) : null
}

function ActionGroup({ actions }: { actions: Action[] }) {
  return actions.length > 0 ? (
    <CommandGroup heading="Actions">
      {actions.map((a) => (
        <CommandItem key={a.label} value={`action-${a.label}`} onSelect={a.run}>
          <a.Icon />
          {a.label}
        </CommandItem>
      ))}
    </CommandGroup>
  ) : null
}

export function CommandMenu({
  items,
  admin,
  logout,
}: {
  items: Pick<NavItem, 'href' | 'label'>[]
  admin: boolean
  logout: () => Promise<void>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  const run = (action: () => void) => {
    setOpen(false)
    action()
  }
  const go = (href: string) => run(() => router.push(href))
  const needle = q.trim().toLowerCase()
  const pages = [
    ...items.map(({ href, label }) => ({ href, label })),
    ...settingsPages(admin).map(([label, href]) => ({ href, label: `Settings: ${label}` })),
  ].filter((p) => p.label.toLowerCase().includes(needle))
  const actions = [
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
      trigger={paletteTrigger}
    >
      <CommandInput value={q} onValueChange={setQ} placeholder="Go to a page or run an action" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <PageGroup pages={pages} go={go} />
        <ActionGroup actions={actions} />
      </CommandList>
    </CommandDialog>
  )
}
