'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function Nav({ needsYou }: { needsYou: number }) {
  const path = usePathname()
  const items = [
    { href: '/', label: 'Tickets', current: path === '/' || path.startsWith('/tickets'), badge: needsYou },
    { href: '/runs', label: 'Runs', current: path.startsWith('/runs'), badge: 0 },
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
