import type { ModelOption, TeamRole, TeamSession } from './types'

/** The profile without the `---` front matter block a role file starts with. */
export const profileBody = (profile: string): string => profile.replace(/^---\n[\s\S]*?\n---\n?/, '')

/** The profile as markdown for the sheet: each "Label: text" line becomes its own paragraph with the label in bold (Mission / Picks up / Hands on / Never); free text is untouched. */
export const profileMarkdown = (profile: string): string => profileBody(profile).replace(/^([A-Z][A-Za-z ]{1,24}): /gm, '\n**$1.** ')

/** First sentence of a markdown profile, markup stripped; a leading "Mission:" label is dropped. */
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "6 roles · 3 sessions connected · 2 working". */
export const teamSummary = (roles: TeamRole[]): string => {
  const all = roles.flatMap((r) => r.sessions)
  return [plural(roles.length, 'role'), `${plural(live(all), 'session')} connected`, `${all.filter((s) => s.status === 'working').length} working`].join(' · ')
}

/** "1 agent", "3 agents", "No limit". */
export const agentsLabel = (agents?: number): string => (agents ? plural(agents, 'agent') : 'No limit')

/** The option value of a role's model setting: `tier:<tier>` or `<provider>/<model>`. */
export const modelValue = (role: Pick<TeamRole, 'tier' | 'provider' | 'model'>): string | undefined => (role.tier ? `tier:${role.tier}` : role.provider && role.model ? `${role.provider}/${role.model}` : undefined)

/** Short readable model name for a chip: "Cheap tier" or the model id. */
export const modelName = (role: Pick<TeamRole, 'tier' | 'model'>): string | undefined => (role.tier ? `${role.tier[0]!.toUpperCase()}${role.tier.slice(1)} tier` : role.model)

export const connectPrompt = (role: Pick<TeamRole, 'id'>): string => `Connect to the factory as ${role.id} and work until I tell you to stop.`

/** Option groups in display order: tiers first, then one group per provider. */
export const groupOptions = (options: ModelOption[]): [group: string, options: ModelOption[]][] => {
  const groups = new Map<string, ModelOption[]>()
  for (const o of options) groups.set(o.group, [...(groups.get(o.group) ?? []), o])
  return [...groups].sort(([a], [b]) => +(b === 'Tier') - +(a === 'Tier'))
}
