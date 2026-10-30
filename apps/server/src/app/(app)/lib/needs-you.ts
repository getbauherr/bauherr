export const STAGES = ['triage', 'plan', 'build', 'review', 'release', 'done'] as const
export type Stage = (typeof STAGES)[number]
export const VIEWS = ['list', 'board', 'runs'] as const
export type View = (typeof VIEWS)[number]

const APPROVED_PLAN = 'bauherr:approved:plan'

/** D5 for v1: plan posted = the latest Run is a succeeded plan Run (tickets carry no comment cache). */
export const needsYou = (
  ticket: { stage: string | null; labels: string[] },
  run: { stage: string; status: string } | null,
): string | null => {
  const stage = ticket.stage ?? 'triage'
  if (stage === 'plan' && !ticket.labels.includes(APPROVED_PLAN) && run?.stage === 'plan' && run.status === 'succeeded') return 'Approve plan'
  if (run?.status === 'needs_human') return 'Run needs you'
  if (stage === 'review') return 'Review MR'
  if (run?.status === 'failed') return 'Run failed'
  return null
}

