import type { Criterion, Finding, TicketRecord } from '../../../core/record/schema'
import type { StatusWord } from './status-words'

export const TABS = ['now', 'brief', 'result', 'activity'] as const
export type Tab = (typeof TABS)[number]

export const TAB_LABELS: Record<Tab, string> = { now: 'Now', brief: 'Brief', result: 'Result', activity: 'Activity' }

export const parseTab = (raw: string | undefined): Tab => TABS.find((tab) => tab === raw) ?? 'now'

export const ticketHref = (recordId: number, tab: Tab, proof?: string): string => {
  const query = new URLSearchParams()
  if (tab !== 'now') query.set('tab', tab)
  if (proof !== undefined) query.set('proof', proof)
  const text = query.toString()
  return text ? `/tickets/${recordId}?${text}` : `/tickets/${recordId}`
}

export const VERIFY_WORDS: Record<Criterion['verify']['kind'], string> = {
  test: 'Test',
  command: 'Command',
  screenshot: 'Screenshot',
  manual: 'Manual check',
}

export const CRITERION_WORDS: Record<Criterion['status'], StatusWord> = {
  open: { word: 'Open', tone: 'neutral' },
  met: { word: 'Met', tone: 'ok', mark: 'check' },
  partial: { word: 'Partly met', tone: 'warn' },
  missing: { word: 'Missing', tone: 'destructive', mark: 'cross' },
  waived: { word: 'Waived', tone: 'neutral' },
}

export const FINDING_WORDS: Record<Finding['status'], StatusWord> = {
  open: { word: 'Open', tone: 'warn' },
  fixing: { word: 'Being fixed', tone: 'accent' },
  fixed: { word: 'Fixed', tone: 'ok', mark: 'check' },
  invalid: { word: 'Invalid', tone: 'neutral' },
}

export const RUN_WORDS: Record<string, StatusWord> = {
  queued: { word: 'Queued', tone: 'neutral', mark: 'clock' },
  claimed: { word: 'Working', tone: 'accent' },
  submitted: { word: 'Finished', tone: 'ok', mark: 'check' },
  failed: { word: 'Failed', tone: 'destructive', mark: 'cross' },
  expired: { word: 'Expired', tone: 'destructive', mark: 'cross' },
  released: { word: 'Released', tone: 'neutral' },
}

export const ROLE_WORDS: Record<string, string> = { builder: 'Builder', reviewer: 'Reviewer', verifier: 'Verifier' }

export const PROOF_WORDS: Record<string, string> = {
  output: 'Output',
  screenshot: 'Screenshot',
  recording: 'Recording',
  link: 'Link',
}

export const FORGE_NAMES: Record<TicketRecord['source']['forge'], string> = { github: 'GitHub', gitlab: 'GitLab' }

export const pullLabel = (forge: TicketRecord['source']['forge'], number: number): string =>
  forge === 'github' ? `pull request #${number} on GitHub` : `merge request !${number} on GitLab`

export const adoptedLine = (adopted: { author: string }): string =>
  adopted.author === '' ? 'Adopted pull request' : `Adopted pull request by ${adopted.author}`

export const clock = (iso: string): string => iso.slice(11, 16)
