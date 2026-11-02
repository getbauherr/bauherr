export const STAGES = ['triage', 'plan', 'build', 'review', 'release', 'done'] as const
/** `parent`: a Ticket whose plan was split into sub-tickets; it has no Runs and closes with its last child. */
export type Stage = (typeof STAGES)[number] | 'parent'
export const BOARD_STAGES: readonly Stage[] = ['triage', 'plan', 'parent', 'build', 'review', 'release', 'done']
/** The `release` stage is shown as Staging; the stage name itself stays. */
export const stageLabel = (s: string): string => (s === 'release' ? 'Staging' : s)

const APPROVED_PLAN = 'bauherr:approved:plan'
const APPROVED_STAGING = 'bauherr:approved:staging'
/** Every value `needsYou` can return; the Ticket page maps each to a Gate with an action (`gates.ts`). */
export const NEEDS = ['Approve plan', 'Answer decisions', 'Answer questions', 'Accept on staging', 'Staging not confirmed', 'Approve production', 'Production deploy failed', 'Run needs you', 'Run failed'] as const
export type Need = (typeof NEEDS)[number]
/** Hold label: Triage asked the owner questions; answering them moves the Ticket to plan. */
export const NEEDS_REFINEMENT = 'bauherr:needs-refinement'
const IN_PROGRESS = ['running', 'queued', 'awaiting_session']

/** Closed tickets are `done`; open ones without a known stage label are `triage`. */
export const stageOf = (t: { state?: string | null; stage?: string | null }): Stage =>
  t.state === 'closed' ? 'done' : BOARD_STAGES.includes(t.stage as Stage) ? (t.stage as Stage) : 'triage'

/**
 * D5 for v1: plan posted = the latest Run is a succeeded plan Run (tickets carry no comment cache).
 * A plan Run still in progress is "Plan in progress", not needs-you. "Run failed" is an addition to D5.
 * D5 (c): a succeeded plan awaiting approval with `unansweredCritical` > 0 is "Answer decisions" (before "Approve plan").
 */
export const needsYou = (
  ticket: { stage: string | null; labels: string[]; releaseState?: string | null; productionState?: string | null },
  run: { stage: string; status: string } | null,
  unansweredCritical = 0,
): Need | null => {
  const stage = ticket.stage ?? 'triage'
  if (stage === 'plan' && run?.stage === 'plan' && IN_PROGRESS.includes(run.status)) return null
  if (stage === 'plan' && !ticket.labels.includes(APPROVED_PLAN) && run?.stage === 'plan' && run.status === 'succeeded') return unansweredCritical ? 'Answer decisions' : 'Approve plan'
  if (stage === 'triage' && ticket.labels.includes(NEEDS_REFINEMENT)) return 'Answer questions'
  if (run?.status === 'needs_human' && run.stage !== 'triage') return 'Run needs you'
  if (stage === 'release' && !ticket.labels.includes(APPROVED_STAGING)) {
    if (ticket.releaseState === 'on_staging') return 'Accept on staging'
    if (ticket.releaseState === 'timed_out') return 'Staging not confirmed'
  }
  if (stage === 'release' && ticket.labels.includes(APPROVED_STAGING)) {
    if (ticket.productionState === 'awaiting_approval') return 'Approve production'
    if (ticket.productionState === 'failed' || ticket.productionState === 'timed_out') return 'Production deploy failed'
  }
  if (run?.status === 'failed' && run.stage !== 'triage') return 'Run failed'
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
    needs_human: 'Needs a human after repeated review rounds',
  })[reviewState ?? ''] ?? 'Factory reviewing'
