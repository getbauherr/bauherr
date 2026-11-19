'use client'
import Link from 'next/link'
import { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from './ui/breadcrumb'
import { usePageTitle } from './PageTitle'

const settingsPage: Record<string, string> = { profile: 'Profile', workspace: 'General', products: 'Products', bauherren: 'People', models: 'Models & budget', health: 'Health', connections: 'Connections', 'api-key': 'API keys', audit: 'Audit' }

type Crumb = { label: string; href?: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function Breadcrumbs() {
  const path = usePathname()
  const title = usePageTitle()
  const [first, second, third] = path.split('/').filter(Boolean)
  const crumbs: Crumb[] = first === 'settings' ? [{ label: 'Settings' }] : [{ label: 'Home', href: '/' }]
  if (first === 'settings' && second) crumbs.push({ label: settingsPage[second] ?? cap(second), href: third ? `/settings/${second}` : undefined })
  if (third) crumbs.push({ label: /^\d+$/.test(third) ? 'Product' : cap(third) })
  if (title && crumbs.length > 1) crumbs[crumbs.length - 1] = { label: title }
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map(({ label, href }, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className={i === crumbs.length - 1 ? 'min-w-0' : 'shrink-0'}>
              {i === crumbs.length - 1 ? <BreadcrumbPage className="truncate">{label}</BreadcrumbPage> : href ? <BreadcrumbLink asChild><Link href={href}>{label}</Link></BreadcrumbLink> : <span>{label}</span>}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
