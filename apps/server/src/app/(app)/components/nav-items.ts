import { Activity, BookOpen, ChartColumn, Inbox, MessageSquare, Package, Settings, Ticket, Users } from './icons'

export type NavItem = { href: string; label: string; Icon: typeof Ticket; match: (path: string) => boolean }

/** Sidebar destinations of the main group; Knowledge needs a Knowledge repo, Runs an Admin. */
export const mainItems = ({ hasKnowledge, admin }: { hasKnowledge: boolean; admin: boolean }): NavItem[] => [
  { href: '/inbox', label: 'Inbox', Icon: Inbox, match: (p) => p.startsWith('/inbox') },
  { href: '/', label: 'Workflow', Icon: Ticket, match: (p) => p === '/' || p.startsWith('/tickets') },
  { href: '/team', label: 'Team', Icon: Users, match: (p) => p.startsWith('/team') },
  { href: '/requests', label: 'Requests', Icon: MessageSquare, match: (p) => p.startsWith('/requests') },
  { href: '/releases', label: 'Releases', Icon: Package, match: (p) => p.startsWith('/releases') },
  ...(hasKnowledge ? [{ href: '/knowledge', label: 'Knowledge', Icon: BookOpen, match: (p: string) => p.startsWith('/knowledge') }] : []),
  ...(admin ? [{ href: '/runs', label: 'Runs', Icon: Activity, match: (p: string) => p.startsWith('/runs') }] : []),
  { href: '/insights', label: 'Insights', Icon: ChartColumn, match: (p: string) => p.startsWith('/insights') },
]

export const settingsItem = (admin: boolean): NavItem => ({ href: admin ? '/settings/workspace' : '/settings/api-key', label: 'Settings', Icon: Settings, match: (p) => p.startsWith('/settings') })

type Entry = [label: string, href: string]
export const settingsOwner: Entry[] = [['General', '/settings/workspace'], ['Products', '/settings/products'], ['People', '/settings/bauherren'], ['AI usage', '/settings/usage']]
export const settingsAdvanced: Entry[] = [['Board & WIP', '/settings/workflow'], ['Templates', '/settings/templates'], ['Connections', '/settings/connections'], ['Agent keys', '/settings/api-key'], ['Audit', '/settings/audit'], ['Chat feedback', '/settings/chat-feedback']]

/** Every Settings page the person can open. */
export const settingsPages = (admin: boolean): Entry[] => [...settingsOwner, ...(admin ? settingsAdvanced : [['Templates', '/settings/templates'] as Entry, ['API key', '/settings/api-key'] as Entry])]
