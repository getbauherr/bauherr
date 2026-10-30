'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

export function Nav({ needsYou }: { needsYou: number }) {
  const path = usePathname()
  const runs = useSearchParams().get('view') === 'runs'
  const items = [
    { href: '/', label: 'Tickets', current: path === '/' && !runs, badge: needsYou },
    { href: '/?view=runs', label: 'Runs', current: path === '/' && runs || path.startsWith('/runs'), badge: 0 },
  ]
  return (
    <nav className="nav" aria-label="Main">
      {items.map(({ href, label, current, badge }) => (
        <Link key={href} href={href} aria-current={current ? 'page' : undefined}>
          {label}
          {badge > 0 && <span className="badge" aria-label={`${badge} need you`}>{badge}</span>}
        </Link>
      ))}
    </nav>
  )
}
