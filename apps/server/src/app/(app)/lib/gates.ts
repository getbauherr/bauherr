import type { Need } from './needs-you'

export type GateCtx = { stage: string; missing: string[]; open: number }
type Kind = 'plan' | 'questions' | 'release' | 'production' | 'production-checks' | 'review-cap' | 'rerun'
export type GateConfig = {
  kind: Kind
  title: string
  /** The ActionBar's left side. */
  sentence: (c: GateCtx) => string
  /** The ActionBar's primary button; the Overview card shows the same word. */
  verb: (c: Pick<GateCtx, 'stage'>) => string
  secondary?: string
}

const s = (n: number) => (n === 1 ? '' : 's')
const rerun = (c: Pick<GateCtx, 'stage'>) => `Re-run ${c.stage}`

/** One mapping from a needs-you value to the Gate the Ticket page shows for it and the copy of its ActionBar. */
export const GATES: Record<Need, GateConfig> = {
  'Approve plan': { kind: 'plan', title: 'Approve plan', sentence: () => 'Approve the plan so the factory can build it.', verb: () => 'Approve plan' },
  'Answer decisions': { kind: 'plan', title: 'Approve plan', sentence: (c) => `Answer the critical decision${s(c.missing.length)} ${c.missing.join(', ')} before you approve the plan.`, verb: () => 'Answer decisions' },
  'Answer questions': { kind: 'questions', title: 'Answer questions', sentence: (c) => `Answer ${c.open} open question${s(c.open)} so planning can start.`, verb: () => 'Answer questions' },
  'Accept on staging': { kind: 'release', title: 'Accept on staging', sentence: () => 'Check the change on staging and accept it.', verb: () => 'Accept on staging', secondary: 'Request changes' },
  'Staging not confirmed': { kind: 'release', title: 'Staging not confirmed', sentence: () => 'The staging deploy was not seen within 60 minutes; check staging yourself.', verb: () => 'Accept on staging', secondary: 'Request changes' },
  'Configure production checks': { kind: 'production-checks', title: 'Configure production checks', sentence: () => 'Production approval is on, but this Product has no production checks.', verb: () => 'Configure checks' },
  'Approve production': { kind: 'production', title: 'Approve production deploy', sentence: () => 'Approve the production deploy.', verb: () => 'Approve production' },
  'Production deploy failed': { kind: 'production', title: 'Production deploy failed', sentence: () => 'The production deploy failed or was not reported; approving retries it.', verb: () => 'Approve again' },
  'Round cap reached': { kind: 'review-cap', title: 'Round cap reached', sentence: () => 'The review sent this back too often; grant one more round or stop.', verb: () => 'Grant one more round', secondary: 'Stop' },
  'Run needs you': { kind: 'rerun', title: 'Run needs you', sentence: (c) => `The ${c.stage} Run needs you.`, verb: rerun },
  'Run failed': { kind: 'rerun', title: 'Run failed', sentence: (c) => `The ${c.stage} Run failed.`, verb: rerun },
}
