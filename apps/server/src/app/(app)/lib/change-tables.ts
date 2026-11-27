export const CHANGE_TABLES = [
  'records',
  'events',
  'stage_runs',
  'mirror_items',
  'mirror_checks',
  'ticket_sources',
  'connections',
  'agent_sessions',
] as const

export type ChangeTable = (typeof CHANGE_TABLES)[number]

export const BOARD_TABLES = [
  'records',
  'events',
  'stage_runs',
  'mirror_items',
  'ticket_sources',
  'connections',
  'agent_sessions',
] as const
export const TICKET_TABLES = ['records', 'events', 'stage_runs', 'mirror_items', 'mirror_checks'] as const
export const SOURCE_TABLES = ['ticket_sources', 'mirror_items', 'records', 'events'] as const
export const SESSION_TABLES = ['agent_sessions', 'stage_runs'] as const
