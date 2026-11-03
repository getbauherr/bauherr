'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Entry = [slug: string, label: string, href?: string]
const items: Entry[] = [['workspace', 'Workspace'], ['products', 'Products'], ['connections', 'Connections'], ['bauherren', 'Bauherren'], ['api-key', 'API key']]
const adminItems: Entry[] = [['audit', 'Audit'], ['workflow', 'Workflow'], ['runs', 'Runs', '/runs']]

export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname()
  return (
    <nav className="snav" aria-label="Settings">
      {(admin ? [...items, ...adminItems] : items).map(([slug, label, href = `/settings/${slug}`]) => (
        <Link key={slug} href={href} aria-current={href === '/runs' ? (path.startsWith('/runs') ? 'page' : undefined) : path === href ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  )
}
