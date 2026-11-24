import { duration, usd } from './format'

export const FIGURE_LABEL: Record<string, string> = {
  ticketsAccepted: 'Accepted',
  firstTryShare: 'First try',
  sendBacks: 'Send-backs',
  verifyRoundsPerTicket: 'Verify rounds per ticket',
  failedRuns: 'Failed runs',
  questions: 'Questions to you',
  secondsToAccepted: 'Lead time',
  costUsd: 'Cost',
  correctionsCameBack: 'Corrections that came back',
}

export const LEVEL_LABEL = {
  product: 'Product',
  workspace: 'Workspace',
  factory: 'Factory',
  ticket: 'Ticket',
} as const

const one = (value: number): string => String(Math.round(value * 10) / 10)

export const figureText = (key: string, value: number | null): string => {
  if (value === null) return '—'
  if (key === 'firstTryShare') return `${Math.round(value * 100)}%`
  if (key === 'verifyRoundsPerTicket') return one(value)
  if (key === 'secondsToAccepted') return duration(value)
  if (key === 'costUsd') return usd(value)
  return String(Math.round(value))
}

export const deltaText = (key: string, value: number | null, previous: number | null): string | null => {
  if (value === null || previous === null || value === previous) return null
  const change = value - previous
  const arrow = change > 0 ? '▲ +' : '▼ −'
  const size = Math.abs(change)
  if (key === 'firstTryShare') return `${arrow}${Math.round(size * 100)} pts`
  if (key === 'secondsToAccepted') return `${arrow}${duration(size)}`
  if (key === 'costUsd') return `${arrow}${usd(size)}`
  return `${arrow}${one(size)}`
}
