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
  const current = (href: string) => (href.includes('#') ? path + hash === href : href === '/runs' ? path.startsWith('/runs') : path === href && !onAnchor) ? 'page' : undefined
  const link = ([label, href]: Entry) => <Link key={href} href={href} aria-current={current(href)}>{label}</Link>
  return (
    <nav className="snav" aria-label="Settings">
      {owner.map(link)}
      {!admin && link(['API key', '/settings/api-key'])}
      {admin && (
        <details className="snav-adv" open={advanced.some(([, href]) => current(href)) || undefined}>
          <summary>Advanced</summary>
          {advanced.map(link)}
        </details>
      )}
    </nav>
  )
}
