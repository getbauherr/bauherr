import { type HumanGate, humanGates } from './mode'

export const STAGES = ['triage', 'plan', 'build', 'review', 'release', 'done'] as const
/** `parent`: a Ticket whose plan was split into sub-tickets; it has no Runs and closes with its last child. */
export type Stage = (typeof STAGES)[number] | 'parent'
/** Board columns; `parent` (epics) is not one, see the Epics view. */
export const BOARD_STAGES: readonly Stage[] = ['triage', 'plan', 'build', 'review', 'release', 'done']
/** The `release` stage is shown as Staging; the stage name itself stays. */
export const stageLabel = (s: string): string => (s === 'release' ? 'Staging' : s)

export const APPROVED_PLAN = 'bauherr:approved:plan'
const APPROVED_STAGING = 'bauherr:approved:staging'
/** Every value `needsYou` can return; the Ticket page maps each to a Gate with an action (`gates.ts`). */
export const NEEDS = ['Approve plan', 'Answer decisions', 'Answer questions', 'Accept on staging', 'Staging not confirmed', 'Configure production checks', 'Approve production', 'Production deploy failed', 'Release failed', 'Round cap reached', 'Needs you', 'Run needs you', 'Cancelled', 'Run failed', 'Expedite?'] as const
export type Need = (typeof NEEDS)[number]
/** Names of the four human touch points, in flow order; Settings > Workflow, docs and README use them. */
export const GATE_NAMES: Record<HumanGate, string> = { refine: 'Refine', plan: 'Approve plan', staging: 'Accept on staging', production: 'Approve production' }
/** Hold label: Triage asked the owner questions; answering them moves the Ticket to plan. */
export const NEEDS_REFINEMENT = 'bauherr:needs-refinement'
/** Expedite lane: the label a human sets (or the Expedite action), and the label Triage sets to propose it. */
export const EXPEDITE_LABEL = 'bauherr:expedite'
export const EXPEDITE_PROPOSED = 'bauherr:expedite-proposed'
/** Returns from review to build per Ticket before it needs a human. */
export const MAX_REVIEW_ROUNDS = 2
const IN_PROGRESS = ['running', 'queued', 'awaiting_session']

/** Closed tickets are `done`; open ones without a known stage label are `triage`. */
export const stageOf = (t: { state?: string | null; stage?: string | null }): Stage =>
  t.state === 'closed' ? 'done' : t.stage === 'parent' || BOARD_STAGES.includes(t.stage as Stage) ? (t.stage as Stage) : 'triage'

/**
 * D5 for v1: plan posted = the latest Run is a succeeded plan Run (tickets carry no comment cache).
 * A plan Run still in progress is "Plan in progress", not needs-you. "Run failed" is an addition to D5.
 * D5 (c): a succeeded plan awaiting approval with `unansweredCritical` > 0 is "Answer decisions" (before "Approve plan").
 */
export const needsYou = (
  ticket: { stage: string | null; labels: string[]; releaseState?: string | null; productionState?: string | null; productionChecksMissing?: boolean; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null },
  run: { stage: string; status: string } | null,
  unansweredCritical = 0,
  gates: readonly HumanGate[] = humanGates(),
): Need | null => {
  const stage = ticket.stage ?? 'triage'
  const accepted = gates.includes('staging') ? ticket.labels.includes(APPROVED_STAGING) : !!ticket.productionState
  if (stage === 'plan' && run?.stage === 'plan' && IN_PROGRESS.includes(run.status)) return null
  if (stage === 'plan' && gates.includes('plan') && !ticket.expedite && !ticket.labels.includes(APPROVED_PLAN) && run?.stage === 'plan' && run.status === 'succeeded') return unansweredCritical ? 'Answer decisions' : 'Approve plan'
  if (stage === 'triage' && ticket.labels.includes(NEEDS_REFINEMENT)) return 'Answer questions'
  if (stage === 'review' && ticket.reviewState === 'needs_human' && (ticket.reviewRounds ?? 0) > MAX_REVIEW_ROUNDS) return 'Round cap reached'
  if (stage === 'review' && ticket.reviewState === 'needs_human') return 'Needs you'
  if (run?.status === 'needs_human' && run.stage !== 'triage') return 'Run needs you'
  if (stage === 'release' && !accepted) {
    if (ticket.releaseState === 'on_staging' && gates.includes('staging')) return 'Accept on staging'
    if (ticket.releaseState === 'timed_out') return 'Staging not confirmed'
  }
  if (stage === 'release' && accepted) {
    if (ticket.productionState === 'awaiting_approval') return ticket.productionChecksMissing ? 'Configure production checks' : 'Approve production'
    if (ticket.productionState === 'failed' || ticket.productionState === 'timed_out') return 'Production deploy failed'
  }
  if (ticket.releaseChecksState === 'failed') return 'Release failed'
  if (run?.status === 'cancelled' && run.stage === stage && ['plan', 'build', 'review'].includes(stage)) return 'Cancelled'
  if (run?.status === 'failed' && run.stage !== 'triage') return 'Run failed'
  if (ticket.labels.includes(EXPEDITE_PROPOSED) && !ticket.expedite && !ticket.labels.includes(EXPEDITE_LABEL) && stage !== 'release') return 'Expedite?'
  return null
}

/** Words for the `release` stage: where the Ticket is between merge and acceptance. */
export const releaseWord = (t: { stage?: string | null; state?: string | null; labels?: string[] | null; releaseState?: string | null; productionState?: string | null }): string | null => {
  if (t.productionState === 'deployed') return 'deployed'
  if (t.stage === 'release' && t.productionState === 'awaiting_approval') return 'awaiting production approval'
  if (t.stage === 'release' && t.productionState === 'deploying') return 'deploying'
  if (t.labels?.includes(APPROVED_STAGING)) return 'accepted'
  if (t.stage !== 'release') return null
  return t.releaseState === 'on_staging' ? 'on staging' : t.releaseState === 'timed_out' ? 'timed out' : 'waiting'
}

/** Where a Ticket in `review` stands: the factory's review and merge gate. */
export const reviewWord = (reviewState?: string | null): string =>
  ({
    waiting_checks: 'Review clean, waiting for checks to finish',
    merged: 'Merged by the factory',
    ready_for_human: 'Review clean, ready for a human to merge',
    needs_human: 'Needs a human, see the latest Comment',
  })[reviewState ?? ''] ?? 'Factory reviewing'
