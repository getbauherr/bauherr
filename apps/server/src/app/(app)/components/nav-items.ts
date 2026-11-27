import { Chart, Factory, Inbox, Memory, Release, Settings, Ticket } from './icons'

export type NavItem = { href: string; label: string; Icon: typeof Factory; match: (path: string) => boolean }

const requestsItem = (): NavItem => ({
  href: '/requests',
  label: 'Requests',
  Icon: Ticket,
  match: (p) => p.startsWith('/requests'),
})

export const mainItems = (productOwner = false): NavItem[] =>
  productOwner ? [requestsItem()] : [...bauherrItems(), requestsItem()]

const bauherrItems = (): NavItem[] => [
  { href: '/', label: 'Factory', Icon: Factory, match: (p) => p === '/' },
  { href: '/inbox', label: 'Inbox', Icon: Inbox, match: (p) => p.startsWith('/inbox') },
  { href: '/releases', label: 'Releases', Icon: Release, match: (p) => p.startsWith('/releases') },
  { href: '/memory', label: 'Memory', Icon: Memory, match: (p) => p.startsWith('/memory') },
  { href: '/insights', label: 'Insights', Icon: Chart, match: (p) => p.startsWith('/insights') },
]

export const settingsItem = (): NavItem => ({
  href: '/settings/profile',
  label: 'Settings',
  Icon: Settings,
  match: (p) => p.startsWith('/settings'),
})

type Entry = [label: string, href: string]
type SettingsGroup = { heading: string; entries: Entry[] }

export const settingsGroups = (admin: boolean): SettingsGroup[] => [
  {
    heading: 'Account',
    entries: [
      ['Profile', '/settings/profile'],
      ['API keys', '/settings/api-key'],
    ],
  },
  {
    heading: 'Workspace',
    entries: [
      ['General', '/settings/workspace'],
      ['Products', '/settings/products'],
      ...(admin
        ? [['Connections', '/settings/connections'] as Entry, ['Models & budget', '/settings/models'] as Entry]
        : []),
      ['People', '/settings/bauherren'],
    ],
  },
  ...(admin
    ? [
        {
          heading: 'Admin',
          entries: [
            ['Health', '/settings/health'],
            ['Audit', '/settings/audit'],
          ] as Entry[],
        },
      ]
    : []),
]

export const settingsPages = (admin: boolean): Entry[] =>
  settingsGroups(admin).flatMap((g) => g.entries.map(([label, href]): Entry => [`${g.heading} › ${label}`, href]))
