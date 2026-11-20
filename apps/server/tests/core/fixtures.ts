import { parseEvent, type AppEvent, type EventType, type Stage } from '../../src/core/events'
import type { Config } from '../../src/core/lifecycle'
import {
  emptyRecord,
  type Criterion,
  type Decision,
  type RecordSource,
  type TicketRecord,
} from '../../src/core/record/schema'

export const source: RecordSource = {
  forge: 'github',
  repo: 'acme/app',
  number: 7,
  reporter: 'jo',
  external: false,
  backlog: false,
}

export const criterion = (n: number, extra: Partial<Criterion> = {}): Criterion => ({
  id: `c${n}`,
  text: `criterion ${n}`,
  verify: { kind: 'test', how: 'a test' },
  status: 'open',
  proof: [],
  ...extra,
})

export const decision = (n: number, extra: Partial<Decision> = {}): Decision => ({
  id: `d${n}`,
  question: `question ${n}`,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  recommended: 'a',
  ...extra,
})

export const answered: Partial<Decision> = { answer: 'a', by: 'owner', at: '2026-11-19T10:00:00Z' }

export const briefed = (extra: Partial<TicketRecord> = {}): TicketRecord => ({
  ...emptyRecord(source, 'bug'),
  goal: 'Fix the thing',
  criteria: [criterion(1), criterion(2), criterion(3)],
  risk: { door: 'two-way', areas: [], rollback: 'revert' },
  ...extra,
})

export const repeat = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i + 1))

export const SAMPLES: Record<EventType, unknown> = {
  'intake.accepted': {},
  'intake.asked': { round: 1 },
  'reporter.replied': {},
  'reporter.reminded': {},
  'reporter.silent': {},
  'intake.closed': { reason: 'duplicate' },
  'intake.disputed': {},
  'run.started': { stage: 'build', runId: 'r1', fingerprint: 'fp' },
  'run.failed': { stage: 'build', runId: 'r1', reason: 'no result' },
  'run.released': { stage: 'build', runId: 'r1' },
  'brief.submitted': { runId: 'r1' },
  'brief.approved': { by: 'rule' },
  'brief.changes-requested': { note: 'shorter' },
  'brief.discarded': {},
  'build.submitted': { runId: 'r1', patchId: 'p1', headSha: 'h1', pr: 12 },
  'checks.finished': { patchId: 'p1', passed: true },
  'verify.passed': { runId: 'r2', patchId: 'p1', headSha: 'h1' },
  'verify.changes': { runId: 'r2', patchId: 'p1' },
  'ship.merged': { sha: 'abc123' },
  'ship.deployed': {},
  'result.accepted': {},
  'result.sent-back': { note: 'not yet' },
  'production.approved': {},
  'production.held': {},
  'owner.note': { note: 'try the other way' },
  'ticket.closed': { reason: 'discarded' },
  'verify.overridden': { patchId: 'p1', headSha: 'h1' },
  'question.asked': { reason: 'failed-runs', options: ['retry', 'discard'] },
  'question.answered': { option: 'retry' },
  'forge.write.started': { kind: 'stage-label', target: { repo: 'acme/app', number: 7 } },
  'forge.write.done': { kind: 'close', target: { repo: 'acme/app', number: 7 } },
  'forge.write.failed': { kind: 'merge', target: { repo: 'acme/app', number: 7 }, reason: 'head moved' },
}

export const ev = <T extends EventType>(type: T, data: Record<string, unknown> = {}): AppEvent =>
  parseEvent({ type, data: { ...(SAMPLES[type] as object), ...data } })

export const CONFIG: Config = {
  caps: { verifyRounds: 2, reporterRounds: 2, failedRuns: 2 },
  riskAreas: ['security'],
  productionGate: false,
  deployChecks: false,
  requiredChecks: true,
  autoClose: true,
}

export const start = (stage: Stage, runId = 'r1') => ev('run.started', { stage, runId })
export const fail = (stage: Stage, runId = 'r1') => ev('run.failed', { stage, runId })

export const inBrief = [ev('intake.accepted')]
export const briefWritten = [...inBrief, start('brief'), ev('brief.submitted')]
export const inBuild = [...briefWritten, ev('brief.approved', { by: 'owner' })]
export const inVerify = [...inBuild, start('build'), ev('build.submitted')]
export const inShip = [
  ...inVerify,
  ev('checks.finished', { passed: true }),
  start('verify', 'r2'),
  ev('verify.passed'),
]
export const merged = [...inShip, ev('ship.merged')]
