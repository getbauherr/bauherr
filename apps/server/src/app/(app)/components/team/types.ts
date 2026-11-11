export type TeamSession = {
  publicId: string
  label: string
  clientName?: string
  clientVersion?: string
  model?: string
  provider?: string
  status: 'working' | 'idle' | 'offline'
  ticket?: { number: number; title: string; stage: string }
  runId?: number
  connectedAt: string
  lastSeenAt: string
  activeSecondsToday: number
  activeSecondsTotal: number
}

export type TeamRole = {
  id: string
  title: string
  avatar: string
  /** Markdown. */
  profile: string
  tier?: string
  provider?: string
  model?: string
  agents?: number
  exceptions?: boolean
  stages: { name: string; title: string; kind: string }[]
  sessions: TeamSession[]
  autonomous: { runId: number; ticket: { number: number; title: string }; executor: 'runner' | 'ci'; since: string }[]
}

export type ModelOption = { value: string; label: string; group: 'Tier' | string }

/** What the role form saves. `agents` absent means no limit. */
export type RoleSettings = { model?: string; agents?: number }

export type ConnectPrompt = (role: TeamRole) => string
