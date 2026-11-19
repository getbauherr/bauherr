import { Settings, Ticket } from './icons'

export type NavItem = { href: string; label: string; Icon: typeof Ticket; match: (path: string) => boolean }

export const mainItems = (): NavItem[] => [{ href: '/', label: 'Home', Icon: Ticket, match: (p) => p === '/' }]

export const settingsItem = (): NavItem => ({ href: '/settings/profile', label: 'Settings', Icon: Settings, match: (p) => p.startsWith('/settings') })

type Entry = [label: string, href: string]
type SettingsGroup = { heading: string; entries: Entry[] }

export const settingsGroups = (admin: boolean): SettingsGroup[] => [
  { heading: 'Account', entries: [['Profile', '/settings/profile'], ['API keys', '/settings/api-key']] },
  { heading: 'Workspace', entries: [['General', '/settings/workspace'], ['Products', '/settings/products'], ...(admin ? [['Connections', '/settings/connections'] as Entry, ['Models & budget', '/settings/models'] as Entry] : []), ['People', '/settings/bauherren']] },
  ...(admin ? [{ heading: 'Admin', entries: [['Health', '/settings/health'], ['Audit', '/settings/audit']] as Entry[] }] : []),
]

export const settingsPages = (admin: boolean): Entry[] => settingsGroups(admin).flatMap((g) => g.entries.map(([label, href]): Entry => [`${g.heading} › ${label}`, href]))
