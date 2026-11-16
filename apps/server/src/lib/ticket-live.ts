import type { CiCounts } from './ci-text'
import { waitingChip, waitingSentence } from './ci-text'
import { is, type Workflow } from './workflow'

type Track = { waitingFor?: string | null; reviewState?: string | null; releaseChecksState?: string | null }

/** The Ticket waits for the checks of its merge request or release. */
export const ciWait = (wf: Workflow, stage: string, t: Track): boolean =>
  t.waitingFor === 'checks' || (is(wf, stage, 'review') && t.reviewState === 'waiting_checks') || t.releaseChecksState === 'waiting'

export type TicketLive = { chip: string; tone: 'neutral' | 'accent' | 'warn'; sentence: string; /** A stale session holds the Run: an Admin may release its lock. */ release?: boolean }

type Session = { publicId: string; health: string; lastSeenAt?: string | null; disconnectedAt?: string | null; endReason?: string | null }
type Step = { n: number; m: number; at: string }

/** "plan step 3 of 5" named by the summary of a reported Step, with the Step's time; null when it names none. */
export const stepOf = (summary: string | null | undefined, at: string | null | undefined): Step | null => {
  const m = /\bstep (\d+) of (\d+)\b/i.exec(summary ?? '')
  return m && at ? { n: Number(m[1]), m: Number(m[2]), at } : null
}

/**
 * What a Ticket with a running Run is truthfully doing: waiting for CI (with the check counts when `counts` is known), stuck or gone with its session (never Working then), waiting for review (`review`: when it was requested), or working (`step`: the last plan-step report). Null when none applies.
 * `release` in the result: an Admin sees "Release lock"; anyone else reads that an Admin can.
 */
export const ticketLive = (row: { ci: boolean; run: { status: string; startedAt?: string | null } | null; counts?: CiCounts | null; session?: Session | null; review?: string | null; step?: Step | null; admin?: boolean }, now = Date.now()): TicketLive | null => {
  if (row.ci) return row.counts ? { chip: waitingChip(row.counts), tone: 'neutral', sentence: waitingSentence(row.counts) } : { chip: 'Waiting for CI', tone: 'neutral', sentence: 'Waiting for CI.' }
  if (row.run?.status !== 'running') return null
  const min = (iso?: string | null) => (iso ? Math.max(0, Math.round((now - +new Date(iso)) / 60000)) : null)
  const ago = (iso?: string | null) => (min(iso) === null ? '' : ` ${min(iso)} min ago`)
  const s = row.session
  if (s && (s.health === 'stuck' || s.health === 'disconnected')) {
    const gone = s.health === 'disconnected'
    const help = row.admin ? '' : ' An Admin can release it.'
    return {
      chip: gone ? 'Session gone' : 'Stuck',
      tone: 'warn',
      sentence: gone ? `Session ${s.publicId} disconnected${s.endReason ? ` (${s.endReason})` : ''}${ago(s.disconnectedAt)}.${help}` : `Not responding${min(s.lastSeenAt) === null ? '' : ` for ${min(s.lastSeenAt)} min`}. Session ${s.publicId} last seen${ago(s.lastSeenAt) || ' never'}.${help}`,
      release: !!row.admin,
    }
  }
  if (row.review) return { chip: 'Waiting for review', tone: 'neutral', sentence: `Review requested${ago(row.review)}.` }
  if (row.step) return { chip: 'Working', tone: 'accent', sentence: `Working on plan step ${row.step.n} of ${row.step.m}. Last report${ago(row.step.at)}.` }
  const started = min(row.run.startedAt)
  return { chip: 'Working', tone: 'accent', sentence: started === null ? 'Working.' : `Working. Started ${started} min ago.` }
}
