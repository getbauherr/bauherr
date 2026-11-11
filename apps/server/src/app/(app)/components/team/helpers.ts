import type { ConnectPrompt, ModelOption, TeamRole, TeamSession } from './types'

/** First sentence of a markdown profile, markup stripped. */
export const tagline = (profile: string): string => {
  const text = profile
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`>]|\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
  return text.match(/^.*?[.!?](?=\s|$)/s)?.[0].replace(/\s+/g, ' ') ?? text.split('\n')[0]!
}

export const live = (sessions: TeamSession[]): number => sessions.filter((s) => s.status !== 'offline').length

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "6 roles · 3 sessions connected · 2 working". */
export const teamSummary = (roles: TeamRole[]): string => {
  const all = roles.flatMap((r) => r.sessions)
  return [plural(roles.length, 'role'), `${plural(live(all), 'session')} connected`, `${all.filter((s) => s.status === 'working').length} working`].join(' · ')
}

export const defaultConnectPrompt: ConnectPrompt = (role) => `Connect to the factory as ${role.id} and work until I tell you to stop.`

/** Option groups in display order: tiers first, then one group per provider. */
export const groupOptions = (options: ModelOption[]): [group: string, options: ModelOption[]][] => {
  const groups = new Map<string, ModelOption[]>()
  for (const o of options) groups.set(o.group, [...(groups.get(o.group) ?? []), o])
  return [...groups].sort(([a], [b]) => +(b === 'Tier') - +(a === 'Tier'))
}

/** UTC clock time, stable between server and client render: "09:14 UTC". */
export const clock = (iso: string): string => `${new Date(iso).toISOString().slice(11, 16)} UTC`
