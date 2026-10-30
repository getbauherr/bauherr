import type { Need } from './needs-you'

export type GateConfig = { kind: 'plan' | 'questions' | 'release' | 'rerun'; title: string }

/** One mapping from a needs-you value to the Gate the Ticket page shows for it. */
export const GATES: Record<Need, GateConfig> = {
  'Approve plan': { kind: 'plan', title: 'Approve plan' },
  'Answer decisions': { kind: 'plan', title: 'Approve plan' },
  'Answer questions': { kind: 'questions', title: 'Answer questions' },
  'Accept on staging': { kind: 'release', title: 'Accept on staging' },
  'Staging not confirmed': { kind: 'release', title: 'Staging not confirmed' },
  'Run needs you': { kind: 'rerun', title: 'Run needs you' },
  'Run failed': { kind: 'rerun', title: 'Run failed' },
}
