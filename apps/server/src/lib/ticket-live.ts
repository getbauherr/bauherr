import type { CiCounts } from './ci-text'
import { waitingChip, waitingSentence } from './ci-text'
import { is, type Workflow } from './workflow'

type Track = { waitingFor?: string | null; reviewState?: string | null; releaseChecksState?: string | null }

/** The Ticket waits for the checks of its merge request or release. */
export const ciWait = (wf: Workflow, stage: string, t: Track): boolean =>
  t.waitingFor === 'checks' || (is(wf, stage, 'review') && t.reviewState === 'waiting_checks') || t.releaseChecksState === 'waiting'

export type TicketLive = { chip: string; tone: 'neutral' | 'accent'; sentence: string }

/** What a Ticket with a running Run is truthfully doing: waiting for CI (with the check counts when `counts` is known) or working. Null when neither applies. */
export const ticketLive = (row: { ci: boolean; run: { status: string; startedAt?: string | null } | null; counts?: CiCounts | null }, now = Date.now()): TicketLive | null => {
  if (row.ci) return row.counts ? { chip: waitingChip(row.counts), tone: 'neutral', sentence: waitingSentence(row.counts) } : { chip: 'Waiting for CI', tone: 'neutral', sentence: 'Waiting for CI.' }
  if (row.run?.status !== 'running') return null
  const min = row.run.startedAt ? Math.max(0, Math.round((now - +new Date(row.run.startedAt)) / 60000)) : null
  return { chip: 'Working', tone: 'accent', sentence: min === null ? 'Working.' : `Working. Started ${min} min ago.` }
}
