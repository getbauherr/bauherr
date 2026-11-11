import { Activity, BookOpen, Bot, ChartColumn, Inbox, MessageSquare, Package, Settings, Ticket } from './icons'

export type NavItem = { href: string; label: string; Icon: typeof Ticket; match: (path: string) => boolean }

/** Sidebar destinations of the main group; Knowledge needs a Knowledge repo, Runs an Admin. */
export const mainItems = ({ hasKnowledge, admin }: { hasKnowledge: boolean; admin: boolean }): NavItem[] => [
  { href: '/inbox', label: 'Inbox', Icon: Inbox, match: (p) => p.startsWith('/inbox') },
  { href: '/', label: 'Workflow', Icon: Ticket, match: (p) => p === '/' || p.startsWith('/tickets') },
  { href: '/team', label: 'Agent team', Icon: Bot, match: (p) => p.startsWith('/team') },
  { href: '/requests', label: 'Requests', Icon: MessageSquare, match: (p) => p.startsWith('/requests') },
  { href: '/releases', label: 'Releases', Icon: Package, match: (p) => p.startsWith('/releases') },
  ...(hasKnowledge ? [{ href: '/knowledge', label: 'Knowledge', Icon: BookOpen, match: (p: string) => p.startsWith('/knowledge') }] : []),
  ...(admin ? [{ href: '/runs', label: 'Runs', Icon: Activity, match: (p: string) => p.startsWith('/runs') }] : []),
  { href: '/insights', label: 'Insights', Icon: ChartColumn, match: (p: string) => p.startsWith('/insights') },
]

/** The sidebar Settings link opens the first page everyone may open. */
export const settingsItem = (): NavItem => ({ href: '/settings/profile', label: 'Settings', Icon: Settings, match: (p) => p.startsWith('/settings') || p.startsWith('/workflow/edit') })

type Entry = [label: string, href: string]
export type SettingsGroup = { heading: string; entries: Entry[] }

/** Settings pages by scope (Account, Factory, Workspace, Admin) that this person may open. */
export const settingsGroups = (admin: boolean): SettingsGroup[] => [
  { heading: 'Account', entries: [['Profile', '/settings/profile'], ['API keys', '/settings/api-key']] },
  { heading: 'Factory', entries: [...(admin ? [['Workflow', '/workflow/edit'] as Entry] : []), ['Templates', '/settings/templates'], ...(admin ? [['Models & budget', '/settings/models'] as Entry] : []), ['AI usage', '/settings/usage']] },
  { heading: 'Workspace', entries: [['General', '/settings/workspace'], ['Products', '/settings/products'], ...(admin ? [['Connections', '/settings/connections'] as Entry] : []), ['People', '/settings/bauherren'], ...(admin ? [['Knowledge', '/settings/knowledge'] as Entry] : [])] },
  ...(admin ? [{ heading: 'Admin', entries: [['Health', '/settings/health'], ['Audit', '/settings/audit'], ['Chat feedback', '/settings/chat-feedback']] as Entry[] }] : []),
]

/** Every Settings page the person can open, labelled with its group for the command palette. */
export const settingsPages = (admin: boolean): Entry[] => settingsGroups(admin).flatMap((g) => g.entries.map(([label, href]): Entry => [`${g.heading} › ${label}`, href]))
