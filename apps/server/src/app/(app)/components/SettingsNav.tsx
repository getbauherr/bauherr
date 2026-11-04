'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type Entry = [label: string, href: string]
const owner: Entry[] = [['General', '/settings/workspace'], ['Products', '/settings/products'], ['People', '/settings/bauherren']]
const advanced: Entry[] = [
  ['Connections', '/settings/connections'], ['Agent keys', '/settings/api-key'], ['Audit', '/settings/audit'], ['Workflow', '/settings/workflow'], ['Runs', '/runs'],
  ['Factory health', '/settings/workspace#health'], ['Gateway key', '/settings/workspace#gateway'], ['Model tiers', '/settings/workspace#tiers'], ['Run mode', '/settings/workspace#run-mode'], ['Knowledge repo', '/settings/workspace#knowledge'],
]

const linkClass = 'block border-l border-l-border px-3 py-2 text-muted-foreground transition-colors duration-(--duration-state) ease-(--ease-out) hover:text-foreground aria-[current]:border-l-primary aria-[current]:text-foreground max-sm:-mb-px max-sm:whitespace-nowrap max-sm:border-l-0 max-sm:border-b max-sm:border-b-transparent max-sm:aria-[current]:border-b-primary'

export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname()
  const [hash, setHash] = useState('')
  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [path])
  const onAnchor = advanced.some(([, href]) => href.includes('#') && href === path + hash)
  const current = (href: string) => (href.includes('#') ? path + hash === href : href === '/runs' ? path.startsWith('/runs') : (path === href || (href === '/settings/products' && path.startsWith(`${href}/`))) && !onAnchor) ? 'page' : undefined
  const link = ([label, href]: Entry, nested?: boolean) => <Link key={href} href={href} aria-current={current(href)} className={nested ? `${linkClass} pl-6 max-sm:inline-block max-sm:pl-3` : linkClass}>{label}</Link>
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
