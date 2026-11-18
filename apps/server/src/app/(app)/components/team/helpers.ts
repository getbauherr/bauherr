import type { ModelOption, TeamRole, TeamSession } from './types'

export const profileBody = (profile: string): string => profile.replace(/^---\n[\s\S]*?\n---\n?/, '')

export const profileMarkdown = (profile: string): string => profileBody(profile).replace(/^([A-Z][A-Za-z ]{1,24}): /gm, '\n**$1.** ')

export const tagline = (profile: string): string => {
  const text = profileBody(profile)
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`>]|\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*Mission:\s*/i, '')
    .trim()
  const first = text.match(/^.*?[.!?](?=\s|$)/s)?.[0].replace(/\s+/g, ' ') ?? text.split('\n')[0]!
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}`
}

export const live = (sessions: TeamSession[]): number => sessions.filter((s) => s.status !== 'offline').length

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const needAgent = (roles: TeamRole[]): TeamRole[] => roles.filter((r) => r.waiting > 0 && live(r.sessions) === 0).sort((a, b) => b.waiting - a.waiting)

export const teamSummary = (roles: TeamRole[]): string => {
  const all = roles.flatMap((r) => r.sessions)
  const working = all.filter((s) => s.status === 'working').length
  const idle = all.filter((s) => s.status === 'idle').length
  const needy = needAgent(roles).length
  return [...(working ? [`${working} working`] : []), ...(idle ? [`${idle} idle`] : []), ...(working || idle ? [] : ['No agents connected']), ...(needy ? [`${plural(needy, 'role')} ${needy === 1 ? 'needs' : 'need'} an agent`] : [])].join(' · ')
}

export const defaultRole = (roles: TeamRole[], lastUsed?: string): { id: string; hint: string } | undefined => {
  const needy = needAgent(roles)[0]
  if (needy) return { id: needy.id, hint: `Default: ${plural(needy.waiting, 'ticket')} waiting, no agent` }
  if (lastUsed && roles.some((r) => r.id === lastUsed)) return { id: lastUsed, hint: 'Default: last used' }
  const newest = roles.flatMap((r) => r.sessions.map((s) => ({ role: r.id, at: s.connectedAt ?? '' }))).sort((a, b) => b.at.localeCompare(a.at))[0]
  if (newest?.at) return { id: newest.role, hint: 'Default: most recently connected' }
  return roles[0] && { id: roles[0].id, hint: 'Default: first role' }
}

export type ListRow = { key: string; kind: 'needs'; role: TeamRole } | { key: string; kind: 'session'; session: TeamSession; role?: TeamRole; orphanRole?: string } | { key: string; kind: 'autonomous'; role: TeamRole; run: TeamRole['autonomous'][number] }

const since = (r: ListRow): string => (r.kind === 'session' ? (r.session.runStartedAt ?? r.session.lastSeenAt ?? '') : r.kind === 'autonomous' ? (r.run.startedAt ?? '') : '')

export const listRows = (roles: TeamRole[], orphans: (TeamSession & { role: string })[]): { rows: ListRow[]; disconnected: ListRow[] } => {
  const sessions: ListRow[] = [
    ...roles.flatMap((role) => role.sessions.map((session): ListRow => ({ key: session.publicId, kind: 'session', session, role }))),
    ...orphans.map((session): ListRow => ({ key: session.publicId, kind: 'session', session, orphanRole: session.role })),
  ]
  const autonomous = roles.flatMap((role) => role.autonomous.map((run): ListRow => ({ key: `run-${run.run}`, kind: 'autonomous', role, run })))
  const gone = (r: ListRow) => r.kind === 'session' && r.session.health === 'disconnected'
  const holds = (r: ListRow) => r.kind === 'autonomous' || (r.kind === 'session' && !!r.session.run)
  const shown = [...sessions, ...autonomous].filter((r) => !gone(r))
  const orphan = (r: ListRow) => r.kind === 'session' && !!r.orphanRole
  const working = shown.filter((r) => holds(r) && !orphan(r)).sort((a, b) => since(a).localeCompare(since(b)))
  const idle = shown.filter((r) => !holds(r) && !orphan(r)).sort((a, b) => since(b).localeCompare(since(a)))
  return {
    rows: [...needAgent(roles).map((role): ListRow => ({ key: `needs-${role.id}`, kind: 'needs', role })), ...working, ...idle, ...shown.filter(orphan)],
    disconnected: sessions.filter(gone).sort((a, b) => (b.kind === 'session' ? (b.session.disconnectedAt ?? '') : '').localeCompare(a.kind === 'session' ? (a.session.disconnectedAt ?? '') : '')),
  }
}

export const agentsLabel = (agents?: number): string => (agents ? plural(agents, 'agent') : 'No limit')

export const modelValue = (role: Pick<TeamRole, 'tier' | 'provider' | 'model'>): string | undefined => (role.tier ? `tier:${role.tier}` : role.provider && role.model ? `${role.provider}/${role.model}` : undefined)

export const modelName = (role: Pick<TeamRole, 'tier' | 'model'>): string | undefined => (role.tier ? `${role.tier[0]!.toUpperCase()}${role.tier.slice(1)} tier` : role.model)

export const connectPrompt = (role: Pick<TeamRole, 'id'>, session?: string): string => `Connect to the factory as ${role.id}${session ? ` with session "${session}"` : ''} and work until I tell you to stop.`

export const groupOptions = (options: ModelOption[]): [group: string, options: ModelOption[]][] => {
  const groups = new Map<string, ModelOption[]>()
  for (const o of options) groups.set(o.group, [...(groups.get(o.group) ?? []), o])
  return [...groups].sort(([a], [b]) => +(b === 'Tier') - +(a === 'Tier'))
}
