import type { EventType, Stage } from './events'

export type Card = { card: 'question'; reason: string; options: string[]; text?: string }
export type Verdict = { patchId: string; headSha: string }
export type LiveRun = { stage: Stage; runId: string; fingerprint: string }

export type State = {
  stage: Stage
  closed: string | null
  card: Card | null
  run: LiveRun | null
  reporter: { rounds: number; waiting: boolean; reminded: boolean }
  verifyRounds: number
  extraRounds: number
  failedRuns: number
  brief: 'none' | 'submitted' | 'approved'
  returned: boolean
  rewriting: boolean
  failure: string | null
  asked: string[]
  adopted: boolean
  waitingAuthor: boolean
  patch: { id: string; pr: number; headSha: string } | null
  reviewed: string | null
  conflict: { patchId: string; base: string } | null
  alreadyDone: { by: string; evidence: string } | null
  checks: 'none' | 'pending' | 'passed' | 'failed'
  verdict: Verdict | null
  overridden: boolean
  merged: boolean
  sentBackAfterMerge: boolean
  mergeSha: string | null
  deployed: boolean
  deployStalled: { reason: 'failed' | 'overdue'; checks: string[] } | null
  accepted: boolean
  note: string | null
  blockedReason: string | null
  last: EventType | null
}

export type FoldOptions = { requiredChecks?: boolean; deployChecks?: boolean }

export const initialState = (): State => ({
  stage: 'intake',
  closed: null,
  card: null,
  run: null,
  reporter: { rounds: 0, waiting: false, reminded: false },
  verifyRounds: 0,
  extraRounds: 0,
  failedRuns: 0,
  brief: 'none',
  returned: false,
  rewriting: false,
  failure: null,
  asked: [],
  adopted: false,
  waitingAuthor: false,
  patch: null,
  reviewed: null,
  conflict: null,
  alreadyDone: null,
  checks: 'none',
  verdict: null,
  overridden: false,
  merged: false,
  sentBackAfterMerge: false,
  mergeSha: null,
  deployed: false,
  deployStalled: null,
  accepted: false,
  note: null,
  blockedReason: null,
  last: null,
})
