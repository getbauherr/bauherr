'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LinkPending } from './LinkPending'

type Entry = [label: string, href: string]
const owner: Entry[] = [['General', '/settings/workspace'], ['Products', '/settings/products'], ['People', '/settings/bauherren'], ['AI usage', '/settings/usage']]
const advanced: Entry[] = [['Board & WIP', '/settings/workflow'], ['Connections', '/settings/connections'], ['Agent keys', '/settings/api-key'], ['Audit', '/settings/audit'], ['Runs', '/runs']]

const linkClass = 'block border-l border-l-border px-3 py-2 text-muted-foreground transition-colors duration-(--duration-state) ease-(--ease-out) hover:text-foreground aria-[current]:border-l-primary aria-[current]:text-foreground max-sm:-mb-px max-sm:whitespace-nowrap max-sm:border-l-0 max-sm:border-b max-sm:border-b-transparent max-sm:aria-[current]:border-b-primary'

export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname()
  const current = (href: string) => (href === '/runs' ? path.startsWith('/runs') : path === href || (href === '/settings/products' && path.startsWith(`${href}/`))) ? 'page' : undefined
  const link = ([label, href]: Entry, nested?: boolean) => <Link key={href} href={href} aria-current={current(href)} className={nested ? `${linkClass} pl-6 max-sm:inline-block max-sm:pl-3` : linkClass}>{label}<LinkPending /></Link>
  return (
    <nav className="flex flex-col max-sm:flex-row max-sm:overflow-x-auto max-sm:border-b max-sm:border-border" aria-label="Settings">
      {owner.map((e) => link(e))}
      {!admin && link(['API key', '/settings/api-key'])}
      {admin && (
        <details className="group block max-sm:w-max max-sm:flex-none max-sm:whitespace-nowrap" open={advanced.some(([, href]) => current(href)) || undefined}>
          <summary className="cursor-pointer border-l border-l-border px-3 py-2 text-muted-foreground group-open:text-foreground max-sm:inline-block max-sm:border-l-0">Advanced</summary>
          {advanced.map((e) => link(e, true))}
        </details>
      )}
    </nav>
  )
}
