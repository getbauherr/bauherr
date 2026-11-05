import { APPROVED_STAGING, type Need, reviewWord } from './needs-you'

/** The one button of the Ticket page: the owner's turn (`enabled`) or, disabled, who has the turn and why (`reason`, plain words). `href` is the Ticket or Run the reason names. */
export type NextStep = { label: string; enabled: boolean; reason: string; href?: string }

type StepTicket = { state?: string | null; stage?: string | null; labels?: string[] | null; reviewState?: string | null; productionState?: string | null; waitingFor?: string | null; waitingReason?: string | null }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/**
 * What the owner sees as the next step. `need` (from `needsYou`) wins and is enabled. Otherwise a disabled step whose reason names the
 * agent-side owner, first match: open blocker, live Run, waiting state (overlap, full column, checks), release/review wait, idle.
 * `waiting` is `waitingText` of a waiting Ticket; `admin` gates the Run number and link (Runs are an Admin view).
 */
export const nextStep = ({ ticket, need, run, waiting, blockers, admin }: { ticket: StepTicket; need: Need | null; run: { id: number; stage: string; status: string; escalation?: { step: number; reason: string } | null } | null; waiting: string | null; blockers: { id: number; number: number }[]; admin: boolean }): NextStep => {
  if (need) return { label: need, enabled: true, reason: '' }
  if (blockers.length) return { label: 'Blocked', enabled: false, reason: `Blocked by ${blockers.map((b) => `#${b.number}`).join(', ')}.`, href: `/tickets/${blockers[0]!.id}` }
  if (run && ['running', 'awaiting_session'].includes(run.status) && run.escalation) return { label: 'Escalated', enabled: false, reason: `Escalated to the strong model (step ${run.escalation.step} of 4): ${run.escalation.reason}${admin ? ` (Run ${run.id})` : ''}.`, ...(admin ? { href: `/runs/${run.id}` } : {}) }
  if (run && ['running', 'awaiting_session'].includes(run.status)) return { label: 'Working', enabled: false, reason: `The factory is working on this${admin ? ` (Run ${run.id})` : ''}.`, ...(admin ? { href: `/runs/${run.id}` } : {}) }
  if (run && run.stage === ticket.stage && ['failed', 'cancelled', 'needs_human'].includes(run.status)) return { label: 'Escalating', enabled: false, reason: 'The last Run stopped; the factory retries it on a stronger model by itself.' }
  const wait = ticket.waitingFor
  if (wait === 'checks') return { label: 'Waiting for checks', enabled: false, reason: 'Waiting for the MR checks to finish. Review starts by itself.' }
  if (wait && waiting) {
    const overlap = /^overlaps #(\d+)$/.exec(ticket.waitingReason ?? '')?.[1]
    const why = overlap ? `waits for #${overlap}, which changes the same files` : waiting.replace(/^Waiting: /, '')
    return { label: 'Queued', enabled: false, reason: `Queued for ${cap(wait)}: ${why}. Starts by itself.` }
  }
  if (ticket.state === 'closed' || ticket.stage === 'done') return { label: 'Done', enabled: false, reason: 'Closed.' }
  if (ticket.stage === 'release') {
    const accepted = ticket.labels?.includes(APPROVED_STAGING) || !!ticket.productionState
    return { label: accepted ? 'Releasing' : 'Waiting for staging', enabled: false, reason: accepted ? 'The factory is releasing this.' : 'The factory is waiting for the staging deploy.' }
  }
  if (ticket.stage === 'review') return { label: 'In review', enabled: false, reason: `In review: ${reviewWord(ticket.reviewState).replace(/^./, (c) => c.toLowerCase())}.` }
  return { label: 'Queued', enabled: false, reason: 'The factory picks this up next.' }
}
