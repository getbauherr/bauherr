import type { ClosedAs } from '../../../core/views/rows'
import type { TicketStatus } from '../../../core/views/status'

export type Tone = 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'destructive'
export type StatusWord = { word: string; tone: Tone; mark?: 'check' | 'cross' | 'clock' }

export const STATUS_WORDS: Record<TicketStatus, StatusWord> = {
  triaging: { word: 'Triaging', tone: 'accent' },
  'drafting-brief': { word: 'Drafting Brief', tone: 'accent' },
  building: { word: 'Building', tone: 'accent' },
  verifying: { word: 'Reviewing', tone: 'accent' },
  queued: { word: 'Queued', tone: 'neutral', mark: 'clock' },
  'waiting-for-checks': { word: 'Waiting for CI', tone: 'neutral', mark: 'clock' },
  'waiting-for-deploy': { word: 'Waiting for deploy', tone: 'neutral', mark: 'clock' },
  'reporter-asked': { word: 'Reporter asked', tone: 'neutral' },
  'question-drafted': { word: 'Question drafted', tone: 'neutral' },
  'waiting-on-author': { word: 'Waiting on author', tone: 'neutral' },
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

export const CLOSED_WORDS: Record<ClosedAs, string> = {
  'not-a-bug': 'Not a bug',
  duplicate: 'Duplicate',
  'not-planned': 'Not planned',
  discarded: 'Discarded',
  'closed-on-forge': 'Closed on the forge',
  archived: 'Archived',
}

export const HELD_SENTENCES: Record<string, string> = {
  'outside-author': 'Outside author.',
  budget: 'Outside author, daily limit reached.',
}
