'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/', label: 'Tickets' },
  { href: '/runs', label: 'Runs' },
]

export function Nav() {
  const path = usePathname()
  return (
    <nav className="nav" aria-label="Main">
      {items.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  )
}
