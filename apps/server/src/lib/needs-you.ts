import { type HumanGate, humanGates } from './mode'
import { kindOfRun } from './stage-text'
import { is, type Kind, liveStages, nameOf, stage, type Workflow, wipStages } from './workflow'

export type Stage = string

export const APPROVED_PLAN = 'bauherr:approved:plan'
export const APPROVED_STAGING = 'bauherr:approved:staging'
export const NEEDS = ['Approve plan', 'Answer decisions', 'Answer questions', 'Accept on staging', 'Staging not confirmed', 'Configure production checks', 'Approve production', 'Production deploy failed', 'Release failed', 'Round cap reached', 'Decision needed', 'Owner review', 'Needs you', 'Run needs you', 'Cancelled', 'Run failed', 'Expedite?', 'Fast lane held'] as const
export type Need = (typeof NEEDS)[number]
export const GATE_NAMES: Record<HumanGate, string> = { refine: 'Refine', plan: 'Approve plan', staging: 'Accept on staging', production: 'Approve production' }
export const NEEDS_REFINEMENT = 'bauherr:needs-refinement'
export const EXPEDITE_LABEL = 'bauherr:expedite'
export const EXPEDITE_SKIP_TOUCH = 'auto:staging:expedite-skip'
export const EXPEDITE_PROPOSED = 'bauherr:expedite-proposed'
export const MAX_REVIEW_ROUNDS = 2
const IN_PROGRESS = ['running', 'queued', 'awaiting_session']

export const PARKING_NEEDS: readonly Need[] = ['Run needs you', 'Needs you', 'Cancelled', 'Run failed', 'Decision needed']

export const parkingNeed = (wf: Workflow, t: { state?: string | null; stage?: string | null }, need: Need | null, run: { status: string } | null): Need | null =>
  need && PARKING_NEEDS.includes(need) && t.state !== 'closed' && !!t.stage && wipStages(wf).includes(t.stage) && !is(wf, t.stage, 'human') && !IN_PROGRESS.includes(run?.status ?? '') ? need : null

export const stageOf = (wf: Workflow, t: { state?: string | null; stage?: string | null }): Stage => {
  return t.state === 'closed' ? nameOf(wf, 'done') : t.stage && stage(wf, t.stage) ? t.stage : nameOf(wf, 'triage')
}

export const needsYou = (
  wf: Workflow,
  ticket: { stage: string | null; labels: string[]; releaseState?: string | null; productionState?: string | null; productionChecksMissing?: boolean; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null; openCriticalDecisions?: number | null; waitingFor?: string | null; laneHeld?: boolean | null; jobsOpen?: boolean | null },
  run: { stage: string; kind?: string | null; job?: string | null; status: string; reasonKind?: string | null } | null,
  unansweredCritical = 0,
  gates: readonly HumanGate[] = humanGates(wf),
): Need | null => {
  const stage = ticket.stage ?? nameOf(wf, 'triage')
  const at = (...k: Kind[]) => is(wf, stage, ...k)
  const runIs = (k: string) => !!run && kindOfRun(wf, run) === k
  const accepted = gates.includes('staging') ? ticket.labels.includes(APPROVED_STAGING) : !!ticket.productionState
  const planRun = runIs('plan') || (!!run?.job && run.stage === stage)
  if (at('plan') && planRun && IN_PROGRESS.includes(run?.status ?? '')) return null
  if (at('plan') && gates.includes('plan') && !ticket.expedite && !ticket.labels.includes(APPROVED_PLAN) && !ticket.jobsOpen && planRun && run?.status === 'succeeded') return unansweredCritical ? 'Answer decisions' : 'Approve plan'
  if (at('triage') && ticket.labels.includes(NEEDS_REFINEMENT)) return ticket.waitingFor ? null : 'Answer questions'
  if (at('human')) return 'Decision needed'
  if (at('review') && ticket.jobsOpen) return 'Owner review'
  if (at('review') && ticket.reviewState === 'needs_human' && (ticket.reviewRounds ?? 0) > MAX_REVIEW_ROUNDS) return 'Round cap reached'
  if (at('review') && ticket.reviewState === 'needs_human') return 'Needs you'
  if (run?.status === 'needs_human' && !(at('release') && run.stage !== stage) && !runIs('triage') && run.reasonKind !== 'stuck') return 'Run needs you'
  if (at('release') && !accepted) {
    if (ticket.releaseState === 'on_staging' && gates.includes('staging') && !ticket.jobsOpen) return 'Accept on staging'
    if (ticket.releaseState === 'timed_out') return 'Staging not confirmed'
  }
  if (at('release') && accepted) {
    if (ticket.productionState === 'awaiting_approval') return ticket.productionChecksMissing ? 'Configure production checks' : 'Approve production'
    if (ticket.productionState === 'failed' || ticket.productionState === 'timed_out') return 'Production deploy failed'
  }
  if (ticket.releaseChecksState === 'failed') return 'Release failed'
  if (run?.status === 'cancelled' && run.stage === stage && liveStages(wf).includes(stage)) return 'Cancelled'
  if (run?.status === 'failed' && !(at('release') && run.stage !== stage) && !runIs('triage') && run.reasonKind && run.reasonKind !== 'stuck') return 'Run failed'
  if (ticket.laneHeld) return 'Fast lane held'
  if (ticket.labels.includes(EXPEDITE_PROPOSED) && !ticket.expedite && !ticket.labels.includes(EXPEDITE_LABEL) && !at('release')) return 'Expedite?'
  return null
}

export const releaseWord = (wf: Workflow, t: { stage?: string | null; state?: string | null; labels?: string[] | null; releaseState?: string | null; productionState?: string | null }): string | null => {
  const released = !!t.stage && is(wf, t.stage, 'release')
  if (t.productionState === 'deployed') return 'deployed'
  if (released && t.productionState === 'awaiting_approval') return 'awaiting production approval'
  if (released && t.productionState === 'deploying') return 'deploying'
  if (t.labels?.includes(APPROVED_STAGING)) return 'accepted'
  if (!released) return null
  return t.releaseState === 'on_staging' ? 'on staging' : t.releaseState === 'timed_out' ? 'timed out' : 'waiting'
}

export const CAUSE_LABEL: Record<string, string> = { 'review-stalled': 'Waiting for a human merge for over 30 min', 'fast-lane-held': 'Holds the fast lane while waiting for a human' }

export const reviewWord = (reviewState?: string | null): string =>
  ({
    waiting_checks: 'Review clean, waiting for checks to finish',
    queued: 'In the merge queue',
    merged: 'Merged by the factory',
    ready_for_human: 'Review clean, ready for a human to merge',
    needs_human: 'Needs a human, see the latest Comment',
  })[reviewState ?? ''] ?? 'Factory reviewing'

type Row = { stage?: string | null; state?: string | null; labels?: string[] | null; releaseState?: string | null; productionState?: string | null; releaseChecksState?: string | null; reviewState?: string | null; reviewRounds?: number | null; expedite?: boolean | null; openCriticalDecisions?: number | null; waitingFor?: string | null; jobsOpen?: boolean | null; parked?: boolean | null; liveness?: { cause?: string; need?: string | null } | null }

export const needsOf = (wf: Workflow, t: Row, run: { stage: string; kind?: string | null; job?: string | null; status: string; reasonKind?: string | null } | null, productionChecksMissing: boolean, gates?: readonly HumanGate[]): Need | null => {
  const need =
  t.parked ? null : t.state !== 'closed' || t.releaseChecksState === 'failed'
    ? needsYou(wf, { stage: t.stage ?? null, labels: t.labels ?? [], releaseState: t.releaseState, productionState: t.productionState, productionChecksMissing, releaseChecksState: t.releaseChecksState, reviewState: t.reviewState, reviewRounds: t.reviewRounds, expedite: t.expedite, waitingFor: t.waitingFor, jobsOpen: t.jobsOpen, laneHeld: t.liveness?.cause === 'fast-lane-held' && t.liveness.need === 'Fast lane held' }, run, 0, gates)
    : null
  return need === 'Approve plan' && (t.openCriticalDecisions ?? 0) > 0 ? 'Answer decisions' : need
}
