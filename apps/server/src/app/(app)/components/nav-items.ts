import { Activity, BookOpen, MessageSquare, Package, Settings, Ticket } from './icons'

export type NavItem = { href: string; label: string; Icon: typeof Ticket; match: (path: string) => boolean }

/** Sidebar destinations of the main group; Knowledge needs a Knowledge repo, Runs an Admin. */
export const mainItems = ({ hasKnowledge, admin }: { hasKnowledge: boolean; admin: boolean }): NavItem[] => [
  { href: '/', label: 'Tickets', Icon: Ticket, match: (p) => p === '/' || p.startsWith('/tickets') },
  { href: '/requests', label: 'Requests', Icon: MessageSquare, match: (p) => p.startsWith('/requests') },
  { href: '/releases', label: 'Releases', Icon: Package, match: (p) => p.startsWith('/releases') },
  ...(hasKnowledge ? [{ href: '/knowledge', label: 'Knowledge', Icon: BookOpen, match: (p: string) => p.startsWith('/knowledge') }] : []),
  ...(admin ? [{ href: '/runs', label: 'Runs', Icon: Activity, match: (p: string) => p.startsWith('/runs') }] : []),
]

export const settingsItem = (admin: boolean): NavItem => ({ href: admin ? '/settings/workspace' : '/settings/api-key', label: 'Settings', Icon: Settings, match: (p) => p.startsWith('/settings') })

type Entry = [label: string, href: string]
export const settingsOwner: Entry[] = [['General', '/settings/workspace'], ['Products', '/settings/products'], ['People', '/settings/bauherren'], ['AI usage', '/settings/usage']]
export const settingsAdvanced: Entry[] = [['Board & WIP', '/settings/workflow'], ['Connections', '/settings/connections'], ['Agent keys', '/settings/api-key'], ['Audit', '/settings/audit']]

/** Every Settings page the person can open. */
export const settingsPages = (admin: boolean): Entry[] => [...settingsOwner, ...(admin ? settingsAdvanced : [['API key', '/settings/api-key'] as Entry])]
