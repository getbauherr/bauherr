import { type CiCounts } from './ci-text'
import { overlapText } from './hold-text'
import { APPROVED_STAGING, type Need, reviewWord } from './needs-you'
import { ciWait, ticketLive } from './ticket-live'
import { is, liveStages, roleOfRun, title, type Workflow } from './workflow'

export type NextStep = { label: string; enabled: boolean; reason: string; links: { text: string; href: string }[]; /** The button is a link (e.g. "Connect an agent") instead of a disabled button. */ href?: string }

type StepTicket = { releaseChecksState?: string | null; state?: string | null; stage?: string | null; labels?: string[] | null; reviewState?: string | null; productionState?: string | null; waitingFor?: string | null; waitingReason?: string | null; parked?: boolean | null }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export const nextStep = ({ wf, ticket, need, run, waiting, blockers, holders = [], admin, connected = true, ci = null }: { wf: Workflow; ticket: StepTicket; need: Need | null; run: { id: number; stage: string; job?: string | null; status: string; escalation?: { step: number; reason: string } | null; /** Hotfix Ticket number this Run was paused for. */ preemptedFor?: number | null; /** Number of the Ticket whose session this expedite Run is pausing, while that session has not released yet. */ pausing?: number | null; /** First line of the latest Step when it is waiting_ci. */ waitingStep?: string | null } | null; waiting: string | null; blockers: { id: number; number: number }[]; /** Tickets named in an overlap hold, resolved by number. */ holders?: { id: number; number: number }[]; admin: boolean; /** Whether an agent of the Run's stage role is connected (matters for `awaiting_session` only). */ connected?: boolean; /** Pending counts of the stored check summary: a running Run whose Ticket waits on checks then reads as waiting for CI. */ ci?: CiCounts | null }): NextStep => {
  const runLink = run && admin ? [{ text: `Run ${run.id}`, href: `/runs/${run.id}` }] : []
  if (need) return { label: need, enabled: true, reason: '', links: [] }
  if (ticket.parked) return { label: 'Parked', enabled: false, reason: 'Parked: resume it or discard it on the epic.', links: [] }
  if (blockers.length) return { label: 'Blocked', enabled: false, reason: `Blocked by ${blockers.map((b) => `#${b.number}`).join(', ')}.`, links: blockers.map((b) => ({ text: `#${b.number}`, href: `/tickets/${b.id}` })) }
  if (run?.status === 'awaiting_session' && run.preemptedFor) return { label: 'Paused', enabled: false, reason: `Paused for hotfix #${run.preemptedFor}. It continues first when the hotfix is done.`, links: [] }
  if (run?.status === 'awaiting_session' && run.pausing) return { label: 'Connect an agent', enabled: false, href: '/team', reason: `Starting: ${roleOfRun(wf, run)?.title ?? 'agent'} session pausing #${run.pausing}, up to 2 min.`, links: [] }
  if (run && ['running', 'awaiting_session'].includes(run.status) && run.escalation) return { label: 'Escalated', enabled: false, reason: `Escalated to the strong model (step ${run.escalation.step} of 4): ${run.escalation.reason}${admin ? ` (Run ${run.id})` : ''}.`, links: runLink }
  const ref = admin ? ` (Run ${run?.id})` : ''
  if (run?.status === 'awaiting_session') {
    const role = roleOfRun(wf, run)?.title
    return { label: 'Connect an agent', enabled: false, href: '/team', reason: connected ? `Waiting for ${role ? `a ${role}` : 'an'} agent to pick this up${ref}.` : `No ${role ? `${role} ` : ''}agent is connected${ref}.`, links: runLink }
  }
  if (run?.status === 'queued') return { label: 'Queued', enabled: false, reason: `Queued for the Runner${ref}.`, links: runLink }
  const live = ticketLive({ ci: ciWait(wf, ticket.stage ?? '', ticket), run, counts: ci })
  if (live?.chip.startsWith('Waiting for CI')) return { label: live.chip, enabled: false, reason: `${live.sentence.replace(/\.$/, '')}${run ? ref : ''}.`, links: runLink }
  if (run?.status === 'running') return { label: 'In progress', enabled: false, reason: `The factory is working on this${ref}.`, links: runLink }
  if (run && run.stage === ticket.stage && liveStages(wf).includes(run.stage) && ['failed', 'cancelled', 'needs_human'].includes(run.status)) return { label: 'Escalating', enabled: false, reason: 'The last Run stopped; the factory retries it on a stronger model by itself.', links: [] }
  const wait = ticket.waitingFor
  if (wait && waiting) {
    const overlap = /^overlaps #(\d+)$/.exec(ticket.waitingReason ?? '')?.[1]
    const reason = overlap ? overlapText(cap(title(wf, wait)), Number(overlap)) : `Queued for ${cap(title(wf, wait))}: ${waiting.replace(/^Waiting: /, '')}.`
    return { label: 'Queued', enabled: false, reason: `${reason} Starts by itself.`, links: overlap ? holders.filter((h) => h.number === Number(overlap)).map((h) => ({ text: `#${h.number}`, href: `/tickets/${h.id}` })) : [] }
  }
  if (ticket.state === 'closed' || !!ticket.stage && is(wf, ticket.stage, 'done')) return { label: 'Done', enabled: false, reason: 'Closed.', links: [] }
  if (ticket.stage && is(wf, ticket.stage, 'release')) {
    const accepted = ticket.labels?.includes(APPROVED_STAGING) || !!ticket.productionState
    return { label: accepted ? 'Releasing' : 'Waiting for staging', enabled: false, reason: accepted ? 'The factory is releasing this.' : 'The factory is waiting for the staging deploy.', links: [] }
  }
  if (ticket.stage && is(wf, ticket.stage, 'review')) return { label: 'In review', enabled: false, reason: `In review: ${reviewWord(ticket.reviewState).replace(/^./, (c) => c.toLowerCase())}.`, links: [] }
  return { label: 'Queued', enabled: false, reason: 'The factory picks this up next.', links: [] }
}

export type Action = { kind: 'expedite' | 'approvePlan' | 'acceptStaging' | 'approveProduction' | 'grantRound' | 'backToBuild' | 'rerun' } | { kind: 'link'; href: string; label?: string; newTab?: boolean }
export type ActionCtx = { run: number | null; open: number; product: number; releaseRunUrl?: string | null }

export const actionFor = (need: Need, { run, open, product, releaseRunUrl }: ActionCtx): Action | null => {
  switch (need) {
    case 'Expedite?': return { kind: 'expedite' }
    case 'Decision needed':
    case 'Fast lane held': return null
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
    case 'Configure production checks': return { kind: 'link', href: `/settings/products/${product}?tab=deploy#production` }
  }
}

export const fallbackFor = (need: Need): { label: string; href: string } => ({ label: `${need}: see details`, href: '#details' })
