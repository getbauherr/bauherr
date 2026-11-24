import { AGENTS_FILE_MAX } from './mirror/facts'

export type Executor = 'runner' | 'session'
export type Reach = 'handed' | 'session' | 'not-loaded'
export type Warning = 'long' | 'cut'

export const REACH_LABEL: Record<Reach, string> = {
  handed: 'Handed by the factory',
  session: "Loaded by the agent's own session",
  'not-loaded': 'Not loaded',
}

export const WARNING_LABEL: Record<Warning, string> = {
  long: 'Over 200 lines',
  cut: 'Cut off before the agent sees it',
}

export const LONG_FILE_LINES = 200

const SESSION_LOADED = [/(^|\/)CLAUDE\.md$/, /^\.ai\/rules\/.+/, /^\.claude\/skills\/.+/, /^\.claude\/agents\/.+/]

export const reachOf = (path: string, executor: Executor): Reach => {
  if (path === 'AGENTS.md') return 'handed'
  if (executor === 'runner') return 'not-loaded'
  return SESSION_LOADED.some((pattern) => pattern.test(path)) ? 'session' : 'not-loaded'
}

export const warningsOf = (path: string, lines: number, chars: number): Warning[] => [
  ...(lines > LONG_FILE_LINES ? (['long'] as const) : []),
  ...(path === 'AGENTS.md' && chars > AGENTS_FILE_MAX ? (['cut'] as const) : []),
]
