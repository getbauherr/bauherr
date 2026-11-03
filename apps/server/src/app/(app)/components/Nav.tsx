'use client'
import { usePathname } from 'next/navigation'
import { Tab, Tabs } from './ui/tabs'

export function Nav({ needsYou, hasKnowledge }: { needsYou: number; hasKnowledge: boolean }) {
  const path = usePathname()
  const items = [
    { href: '/', label: 'Tickets', current: path === '/' || path.startsWith('/tickets'), badge: needsYou },
    ...(hasKnowledge ? [{ href: '/knowledge', label: 'Knowledge', current: path.startsWith('/knowledge'), badge: 0 }] : []),
  ]
  return (
    <Tabs aria-label="Main" className="max-sm:order-3 max-sm:basis-full">
      {items.map(({ href, label, current, badge }) => (
        <Tab key={href} href={href} aria-current={current ? 'page' : undefined} className="h-14 max-sm:h-10">
          {label}
          {badge > 0 && <span className="ml-2 font-mono text-xs/4 font-medium text-muted-foreground" aria-label={`${badge} need you`}>{badge}</span>}
        </Tab>
      ))}
    </Tabs>
  )
}
