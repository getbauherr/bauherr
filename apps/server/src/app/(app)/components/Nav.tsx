'use client'
import { usePathname } from 'next/navigation'
import { Tab, Tabs } from './ui/tabs'

export function Nav({ needsYou, drafts, hasKnowledge }: { needsYou: number; drafts: number; hasKnowledge: boolean }) {
  const path = usePathname()
  const items = [
    { href: '/requests', label: 'Requests', current: path.startsWith('/requests'), badge: drafts, noun: 'drafts' },
    { href: '/', label: 'Tickets', current: path === '/' || path.startsWith('/tickets'), badge: needsYou, noun: 'need you' },
    ...(hasKnowledge ? [{ href: '/knowledge', label: 'Knowledge', current: path.startsWith('/knowledge'), badge: 0, noun: '' }] : []),
  ]
  return (
    <Tabs aria-label="Main" className="max-sm:order-3 max-sm:basis-full">
      {items.map(({ href, label, current, badge, noun }) => (
        <Tab key={href} href={href} aria-current={current ? 'page' : undefined} className="h-14 max-sm:h-10">
          {label}
          {badge > 0 && <span className="ml-2 font-mono text-xs/4 font-medium text-muted-foreground" aria-label={`${badge} ${noun}`}>{badge}</span>}
        </Tab>
      ))}
    </Tabs>
  )
}
