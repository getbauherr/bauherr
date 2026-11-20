import type { TicketStatus } from '../../../core/views/status'

export type Tone = 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'destructive'
export type StatusWord = { word: string; tone: Tone; mark?: 'check' | 'cross' | 'clock' }

export const STATUS_WORDS: Record<TicketStatus, StatusWord> = {
  triaging: { word: 'Triaging', tone: 'accent' },
  'drafting-brief': { word: 'Drafting Brief', tone: 'accent' },
  building: { word: 'Building', tone: 'accent' },
  verifying: { word: 'Reviewing', tone: 'accent' },
  'waiting-for-checks': { word: 'Waiting for CI', tone: 'neutral', mark: 'clock' },
  'waiting-for-deploy': { word: 'Waiting for deploy', tone: 'neutral', mark: 'clock' },
  'reporter-asked': { word: 'Reporter asked', tone: 'neutral' },
  'brief-needs-approval': { word: 'Brief needs approval', tone: 'warn' },
  'result-ready': { word: 'Result ready', tone: 'warn' },
  question: { word: 'Question', tone: 'warn' },
  'failed-runs': { word: 'Failed repeatedly', tone: 'destructive', mark: 'cross' },
  'verify-rounds': { word: 'Sent back repeatedly', tone: 'destructive', mark: 'cross' },
  'reporter-silent': { word: 'Reporter silent', tone: 'destructive', mark: 'cross' },
  parked: { word: 'Parked', tone: 'neutral' },
  accepted: { word: 'Accepted', tone: 'ok', mark: 'check' },
  closed: { word: 'Closed', tone: 'neutral' },
}

export const STUCK_SENTENCES: Record<string, string> = {
  'failed-runs': 'failed repeatedly and waits for your answer.',
  'verify-rounds': 'was sent back from Verify repeatedly and waits for your answer.',
  'reporter-silent': 'has a reporter who did not answer and waits for your decision.',
}

export const HELD_SENTENCES: Record<string, string> = {
  'outside-author': 'Outside author.',
  budget: 'Outside author, daily limit reached.',
}
