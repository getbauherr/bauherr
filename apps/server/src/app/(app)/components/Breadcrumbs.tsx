'use client'
import Link from 'next/link'
import { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from './ui/breadcrumb'
import { usePageTitle } from './PageTitle'

const sections: Record<string, { label: string; one: string }> = {
  inbox: { label: 'Inbox', one: 'Inbox' },
  requests: { label: 'Requests', one: 'Request' },
  releases: { label: 'Releases', one: 'Release' },
  knowledge: { label: 'Knowledge', one: 'Document' },
  runs: { label: 'Runs', one: 'Run' },
  team: { label: 'Agent team', one: 'Agent team' },
  insights: { label: 'Insights', one: 'Insights' },
  tickets: { label: 'Workflow', one: 'Ticket' },
  settings: { label: 'Settings', one: 'Settings' },
  'release-notes': { label: 'Release notes', one: 'Release notes' },
  setup: { label: 'Set up', one: 'Set up' },
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const settingsPage: Record<string, string> = { profile: 'Profile', workspace: 'General', products: 'Products', bauherren: 'People', usage: 'AI usage', workflow: 'Workflow', models: 'Models & budget', knowledge: 'Knowledge', health: 'Health', connections: 'Connections', 'api-key': 'API keys', audit: 'Audit', templates: 'Templates', 'chat-feedback': 'Chat feedback' }

type Crumb = { label: string; href?: string }

/** Section › page from the pathname; a page replaces the last label with `<PageTitle>`. */
export function Breadcrumbs() {
  const path = usePathname()
  const title = usePageTitle()
  const [first, second, third] = path.split('/').filter(Boolean)
  const section = first ? (sections[first] ?? { label: first, one: first }) : sections.tickets
  const crumbs: Crumb[] = [{ label: section.label, href: first === 'settings' ? undefined : first && first !== 'tickets' ? `/${first}` : '/' }]
  if (first === 'settings' && second) crumbs.push({ label: settingsPage[second] ?? cap(second), href: third ? `/settings/${second}` : undefined })
  else if (second) crumbs.push({ label: /^\d+$/.test(second) ? section.one : cap(second) })
  if (third) crumbs.push({ label: /^\d+$/.test(third) ? 'Product' : cap(third) })
  if (title && crumbs.length > 1) crumbs[crumbs.length - 1] = { label: title }
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map(({ label, href }, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="min-w-0">
              {i === crumbs.length - 1 ? <BreadcrumbPage className="truncate">{label}</BreadcrumbPage> : href ? <BreadcrumbLink asChild><Link href={href}>{label}</Link></BreadcrumbLink> : <span>{label}</span>}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
