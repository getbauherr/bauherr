'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [['workspace', 'Workspace'], ['products', 'Products'], ['connections', 'Connections'], ['bauherren', 'Bauherren']]
const adminItems = [['audit', 'Audit'], ['workflow', 'Workflow']]

export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname()
  return (
    <nav className="snav" aria-label="Settings">
      {(admin ? [...items, ...adminItems] : items).map(([slug, label]) => (
        <Link key={slug} href={`/settings/${slug}`} aria-current={path === `/settings/${slug}` ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  )
}
