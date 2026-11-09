import { APPROVED_STAGING, type Need, reviewWord } from './needs-you'

/** The one button of the Ticket page: the owner's turn (`enabled`) or, disabled, who has the turn and why (`reason`, plain words). `links` has one entry per Ticket (`#N`) or Run (`Run N`) the reason names, `text` being the token as written. */
export type NextStep = { label: string; enabled: boolean; reason: string; links: { text: string; href: string }[] }

type StepTicket = { state?: string | null; stage?: string | null; labels?: string[] | null; reviewState?: string | null; productionState?: string | null; waitingFor?: string | null; waitingReason?: string | null }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/**
 * What the owner sees as the next step. `need` (from `needsYou`) wins and is enabled. Otherwise a disabled step whose reason names the
 * agent-side owner, first match: open blocker, live Run, waiting state (overlap, full column, checks), release/review wait, idle.
 * `waiting` is `waitingText` of a waiting Ticket; `admin` gates the Run number and link (Runs are an Admin view).
 */
export const nextStep = ({ ticket, need, run, waiting, blockers, holders = [], admin }: { ticket: StepTicket; need: Need | null; run: { id: number; stage: string; status: string; escalation?: { step: number; reason: string } | null } | null; waiting: string | null; blockers: { id: number; number: number }[]; /** Tickets named in an overlap hold, resolved by number. */ holders?: { id: number; number: number }[]; admin: boolean }): NextStep => {
  const runLink = run && admin ? [{ text: `Run ${run.id}`, href: `/runs/${run.id}` }] : []
  if (need) return { label: need, enabled: true, reason: '', links: [] }
  if (blockers.length) return { label: 'Blocked', enabled: false, reason: `Blocked by ${blockers.map((b) => `#${b.number}`).join(', ')}.`, links: blockers.map((b) => ({ text: `#${b.number}`, href: `/tickets/${b.id}` })) }
  if (run && ['running', 'awaiting_session'].includes(run.status) && run.escalation) return { label: 'Escalated', enabled: false, reason: `Escalated to the strong model (step ${run.escalation.step} of 4): ${run.escalation.reason}${admin ? ` (Run ${run.id})` : ''}.`, links: runLink }
  if (run && ['running', 'awaiting_session'].includes(run.status)) return { label: 'Working', enabled: false, reason: `The factory is working on this${admin ? ` (Run ${run.id})` : ''}.`, links: runLink }
  if (run && run.stage === ticket.stage && ['plan', 'build', 'review'].includes(run.stage) && ['failed', 'cancelled', 'needs_human'].includes(run.status)) return { label: 'Escalating', enabled: false, reason: 'The last Run stopped; the factory retries it on a stronger model by itself.', links: [] }
  const wait = ticket.waitingFor
  if (wait === 'checks') return { label: 'Waiting for checks', enabled: false, reason: 'Waiting for the MR checks to finish. Review starts by itself.', links: [] }
  if (wait && waiting) {
    const overlap = /^overlaps #(\d+)$/.exec(ticket.waitingReason ?? '')?.[1]
    const why = overlap ? `waits for #${overlap}, which changes the same files` : waiting.replace(/^Waiting: /, '')
    return { label: 'Queued', enabled: false, reason: `Queued for ${cap(wait)}: ${why}. Starts by itself.`, links: overlap ? holders.filter((h) => h.number === Number(overlap)).map((h) => ({ text: `#${h.number}`, href: `/tickets/${h.id}` })) : [] }
  }
  if (ticket.state === 'closed' || ticket.stage === 'done') return { label: 'Done', enabled: false, reason: 'Closed.', links: [] }
  if (ticket.stage === 'release') {
    const accepted = ticket.labels?.includes(APPROVED_STAGING) || !!ticket.productionState
    return { label: accepted ? 'Releasing' : 'Waiting for staging', enabled: false, reason: accepted ? 'The factory is releasing this.' : 'The factory is waiting for the staging deploy.', links: [] }
  }
  if (ticket.stage === 'review') return { label: 'In review', enabled: false, reason: `In review: ${reviewWord(ticket.reviewState).replace(/^./, (c) => c.toLowerCase())}.`, links: [] }
  return { label: 'Queued', enabled: false, reason: 'The factory picks this up next.', links: [] }
}

/** What the owner's button does for a need, or null when the need has no direct action or its input is missing (`fallbackFor` then takes over). `label` overrides the gate verb. */
export type Action = { kind: 'expedite' | 'approvePlan' | 'acceptStaging' | 'approveProduction' | 'grantRound' | 'backToBuild' | 'rerun' } | { kind: 'link'; href: string; label?: string; newTab?: boolean }
export type ActionCtx = { run: number | null; open: number; product: number; releaseRunUrl?: string | null }

export const actionFor = (need: Need, { run, open, product, releaseRunUrl }: ActionCtx): Action | null => {
  switch (need) {
    case 'Expedite?': return { kind: 'expedite' }
    case 'Approve plan': return { kind: 'approvePlan' }
    case 'Accept on staging':
    case 'Staging not confirmed': return { kind: 'acceptStaging' }
    case 'Approve production':
    case 'Production deploy failed': return { kind: 'approveProduction' }
    case 'Release failed': return releaseRunUrl ? { kind: 'link', href: releaseRunUrl, newTab: true } : null
    case 'Round cap reached': return { kind: 'grantRound' }
    case 'Needs you': return { kind: 'backToBuild' }
    case 'Cancelled':
    case 'Run needs you':
    case 'Run failed': return run ? { kind: 'rerun' } : null
    case 'Answer decisions':
    case 'Answer questions': return { kind: 'link', href: '#answer', label: `Answer ${open} question${open === 1 ? '' : 's'}` }
    case 'Configure production checks': return { kind: 'link', href: `/settings/products/${product}#production` }
  }
}

/** The button when `actionFor` has none, so the bar never shows zero buttons: the details section. No Run here, the newest Run is not necessarily the one the need is about. */
export const fallbackFor = (need: Need): { label: string; href: string } => ({ label: `${need}: see details`, href: '#details' })
