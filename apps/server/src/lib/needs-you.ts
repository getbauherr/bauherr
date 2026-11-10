import { type HumanGate, humanGates } from './mode'
import { kindOfRun } from './stage-text'
import { DEFAULT, is, type Kind, liveStages, nameOf, stage } from './workflow'

/** A stage name of the workflow; `parent` is a Ticket whose plan was split into sub-tickets (no Runs, closes with its last child). */
export type Stage = string

export const APPROVED_PLAN = 'bauherr:approved:plan'
export const APPROVED_STAGING = 'bauherr:approved:staging'
/** Every value `needsYou` can return; the Ticket page maps each to a Gate with an action (`gates.ts`). */
export const NEEDS = ['Approve plan', 'Answer decisions', 'Answer questions', 'Accept on staging', 'Staging not confirmed', 'Configure production checks', 'Approve production', 'Production deploy failed', 'Release failed', 'Round cap reached', 'Needs you', 'Run needs you', 'Cancelled', 'Run failed', 'Expedite?'] as const
export type Need = (typeof NEEDS)[number]
/** Names of the four human touch points, in flow order; Settings > Board & WIP, docs and README use them. */
export const GATE_NAMES: Record<HumanGate, string> = { refine: 'Refine', plan: 'Approve plan', staging: 'Accept on staging', production: 'Approve production' }
/** Hold label: Triage asked the owner questions; answering them moves the Ticket to plan. */
export const NEEDS_REFINEMENT = 'bauherr:needs-refinement'
/** Expedite lane: the label a human sets (or the Expedite action), and the label Triage sets to propose it. */
export const EXPEDITE_LABEL = 'bauherr:expedite'
/** Touch kind of a staging gate skipped for a Hotfix by the Product setting `expediteSkipStaging`. */
export const EXPEDITE_SKIP_TOUCH = 'auto:staging:expedite-skip'
export const EXPEDITE_PROPOSED = 'bauherr:expedite-proposed'
/** Returns from review to build per Ticket before it needs a human. */
export const MAX_REVIEW_ROUNDS = 2
const IN_PROGRESS = ['running', 'queued', 'awaiting_session']

/** Closed tickets are `done`; open ones without a known stage label are `triage`. */
export const stageOf = (t: { state?: string | null; stage?: string | null }): Stage => {
  const wf = DEFAULT()
  return t.state === 'closed' ? nameOf(wf, 'done') : t.stage && stage(wf, t.stage) ? t.stage : nameOf(wf, 'triage')
}

/**
 * D5 for v1: plan posted = the latest Run is a succeeded plan Run (tickets carry no comment cache).
 * A plan Run still in progress is "Plan in progress", not needs-you. "Run failed" is an addition to D5.
 * D5 (c): a succeeded plan awaiting approval with `unansweredCritical` > 0 is "Answer decisions" (before "Approve plan").
 */
export const needsYou = (
  ticket: { stage: string | null; labels: string[]; releaseState?: string | null; productionState?: string | null; productionChecksMissing?: boolean; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null; openCriticalDecisions?: number | null },
  run: { stage: string; kind?: string | null; status: string; reasonKind?: string | null } | null,
  unansweredCritical = 0,
  gates: readonly HumanGate[] = humanGates(),
): Need | null => {
  const wf = DEFAULT()
  const stage = ticket.stage ?? nameOf(wf, 'triage')
  const at = (...k: Kind[]) => is(wf, stage, ...k)
  const runIs = (k: string) => !!run && kindOfRun(wf, run) === k
  const accepted = gates.includes('staging') ? ticket.labels.includes(APPROVED_STAGING) : !!ticket.productionState
  if (at('plan') && runIs('plan') && IN_PROGRESS.includes(run?.status ?? '')) return null
  if (at('plan') && gates.includes('plan') && !ticket.expedite && !ticket.labels.includes(APPROVED_PLAN) && runIs('plan') && run?.status === 'succeeded') return unansweredCritical ? 'Answer decisions' : 'Approve plan'
  if (at('triage') && ticket.labels.includes(NEEDS_REFINEMENT)) return 'Answer questions'
  if (at('review') && ticket.reviewState === 'needs_human' && (ticket.reviewRounds ?? 0) > MAX_REVIEW_ROUNDS) return 'Round cap reached'
  if (at('review') && ticket.reviewState === 'needs_human') return 'Needs you'
  // `stuck` is the factory's to escalate to a stronger model; the other kinds, and a Run that never said, are the owner's.
  if (run?.status === 'needs_human' && !runIs('triage') && run.reasonKind !== 'stuck') return 'Run needs you'
  if (at('release') && !accepted) {
    if (ticket.releaseState === 'on_staging' && gates.includes('staging')) return 'Accept on staging'
    if (ticket.releaseState === 'timed_out') return 'Staging not confirmed'
  }
  if (at('release') && accepted) {
    if (ticket.productionState === 'awaiting_approval') return ticket.productionChecksMissing ? 'Configure production checks' : 'Approve production'
    if (ticket.productionState === 'failed' || ticket.productionState === 'timed_out') return 'Production deploy failed'
  }
  if (ticket.releaseChecksState === 'failed') return 'Release failed'
  if (run?.status === 'cancelled' && run.stage === stage && liveStages(wf).includes(stage)) return 'Cancelled'
  // A failed Run is the owner's only once the escalation ladder ended (`reasonKind` set by `escalate`); until then the factory retries it on a stronger model.
  if (run?.status === 'failed' && !runIs('triage') && run.reasonKind && run.reasonKind !== 'stuck') return 'Run failed'
  if (ticket.labels.includes(EXPEDITE_PROPOSED) && !ticket.expedite && !ticket.labels.includes(EXPEDITE_LABEL) && !at('release')) return 'Expedite?'
  return null
}

/** Words for the `release` stage: where the Ticket is between merge and acceptance. */
export const releaseWord = (t: { stage?: string | null; state?: string | null; labels?: string[] | null; releaseState?: string | null; productionState?: string | null }): string | null => {
  const released = !!t.stage && is(DEFAULT(), t.stage, 'release')
  if (t.productionState === 'deployed') return 'deployed'
  if (released && t.productionState === 'awaiting_approval') return 'awaiting production approval'
  if (released && t.productionState === 'deploying') return 'deploying'
  if (t.labels?.includes(APPROVED_STAGING)) return 'accepted'
  if (!released) return null
  return t.releaseState === 'on_staging' ? 'on staging' : t.releaseState === 'timed_out' ? 'timed out' : 'waiting'
}

/** Factory health text of liveness causes that are not self-explanatory. */
export const CAUSE_LABEL: Record<string, string> = { 'review-stalled': 'Waiting for a human merge for over 30 min' }

/** Where a Ticket in `review` stands: the factory's review and merge gate. */
export const reviewWord = (reviewState?: string | null): string =>
  ({
    waiting_checks: 'Review clean, waiting for checks to finish',
    queued: 'In the merge queue',
    merged: 'Merged by the factory',
    ready_for_human: 'Review clean, ready for a human to merge',
    needs_human: 'Needs a human, see the latest Comment',
  })[reviewState ?? ''] ?? 'Factory reviewing'

type Row = { stage?: string | null; state?: string | null; labels?: string[] | null; releaseState?: string | null; productionState?: string | null; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null; openCriticalDecisions?: number | null }

/** What a Ticket row needs from the owner: the one input-builder behind the overview rows and the `tickets.needsYou` column the top bar counts, so they cannot drift. Closed Tickets only while a release check failed. */
export const needsOf = (t: Row, run: { stage: string; kind?: string | null; status: string; reasonKind?: string | null } | null, productionChecksMissing: boolean): Need | null => {
  const need =
  t.state !== 'closed' || t.releaseChecksState === 'failed'
    ? needsYou({ stage: t.stage ?? null, labels: t.labels ?? [], releaseState: t.releaseState, productionState: t.productionState, productionChecksMissing, releaseChecksState: t.releaseChecksState, reviewState: t.reviewState, reviewRounds: t.reviewRounds, expedite: t.expedite }, run)
    : null
  // The stored count of unanswered critical decisions turns "Approve plan" into "Answer decisions" without a forge call.
  return need === 'Approve plan' && (t.openCriticalDecisions ?? 0) > 0 ? 'Answer decisions' : need
}
