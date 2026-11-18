export type { TeamRole, TeamSession } from '../../../../lib/sessions'

export type ModelOption = { value: string; label: string; group: 'Tier' | string }

export type RoleSettings = { model?: string; agents?: number }

export type SaveResult = { error?: string } | void
