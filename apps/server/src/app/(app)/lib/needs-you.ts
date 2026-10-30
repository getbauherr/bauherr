export const STAGES = ['triage', 'plan', 'build', 'review', 'release', 'done'] as const
export type Stage = (typeof STAGES)[number]
export const VIEWS = ['list', 'board', 'runs'] as const
export type View = (typeof VIEWS)[number]

const APPROVED_PLAN = 'bauherr:approved:plan'
const IN_PROGRESS = ['running', 'queued', 'awaiting_session']

/** Closed tickets are `done`; open ones without a known stage label are `triage`. */
export const stageOf = (t: { state?: string | null; stage?: string | null }): Stage =>
  t.state === 'closed' ? 'done' : STAGES.includes(t.stage as Stage) ? (t.stage as Stage) : 'triage'

/**
 * D5 for v1: plan posted = the latest Run is a succeeded plan Run (tickets carry no comment cache).
 * A plan Run still in progress is "Plan in progress", not needs-you. "Run failed" is an addition to D5.
 * D5 (c): a succeeded plan awaiting approval with `unansweredCritical` > 0 is "Answer decisions" (before "Approve plan").
 */
export const needsYou = (
  ticket: { stage: string | null; labels: string[] },
  run: { stage: string; status: string } | null,
  unansweredCritical = 0,
): string | null => {
  const stage = ticket.stage ?? 'triage'
  if (stage === 'plan' && run?.stage === 'plan' && IN_PROGRESS.includes(run.status)) return null
  if (stage === 'plan' && !ticket.labels.includes(APPROVED_PLAN) && run?.stage === 'plan' && run.status === 'succeeded') return unansweredCritical ? 'Answer decisions' : 'Approve plan'
  if (run?.status === 'needs_human') return 'Run needs you'
  if (stage === 'review') return 'Review MR'
  if (run?.status === 'failed') return 'Run failed'
  return null
}
