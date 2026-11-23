import { createHash } from 'node:crypto'
import type { AppEvent, EventOf, Stage } from './events'
import { fold, type FoldOptions, type State } from './fold'
import type { TicketRecord } from './record/schema'

export { fold, type State }

export const foldOptions = (
  config: Pick<Config, 'productionGate' | 'requiredChecks' | 'deployChecks'>,
): FoldOptions => ({
  productionGate: config.productionGate,
  requiredChecks: config.requiredChecks,
  deployChecks: config.deployChecks,
})

export type Config = {
  caps: { verifyRounds: number; reporterRounds: number; failedRuns: number }
  riskAreas: string[]
  productionGate: boolean
  deployChecks: boolean
  deployNames: string[]
  deployWaitMinutes: number
  requiredChecks: boolean
  autoClose: boolean
}

export type Role = 'builder' | 'reviewer' | 'verifier'
export type WaitOn = 'reporter' | 'run' | 'checks' | 'deploy' | 'owner' | 'author'
export type BriefReason =
  | 'open-decision'
  | 'one-way-door'
  | 'risk-area'
  | 'visible-change'
  | 'backlog'
  | 'external-request'
  | 'sent-back'
export type Step =
  | { kind: 'run'; stage: Stage; role: Role }
  | { kind: 'card'; card: 'brief' | 'result' | 'question'; reason: string; options: string[] }
  | { kind: 'emit'; event: AppEvent }
  | { kind: 'effect'; effect: 'merge' }
  | { kind: 'wait'; on: WaitOn }
  | { kind: 'done' }

type Rule = (record: TicketRecord, state: State, config: Config) => Step | null

export const fingerprint = (value: unknown): string => {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical)
    if (v === null || typeof v !== 'object') return v
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

const GATES: { reason: BriefReason; applies: (record: TicketRecord, riskAreas: string[]) => boolean }[] = [
  { reason: 'open-decision', applies: (r) => r.decisions.some((d) => d.answer === undefined) },
  { reason: 'one-way-door', applies: (r) => r.risk?.door === 'one-way' },
  { reason: 'risk-area', applies: (r, areas) => (r.risk?.areas ?? []).some((a) => areas.includes(a)) },
  { reason: 'visible-change', applies: (r) => r.visible },
  { reason: 'backlog', applies: (r) => r.source.backlog && r.source.adopted === undefined },
  {
    reason: 'external-request',
    applies: (r) => r.source.external && (r.type === 'feature' || r.type === 'change'),
  },
]

export const briefGate = (record: TicketRecord, config: Pick<Config, 'riskAreas'>): BriefReason | null =>
  GATES.find((gate) => gate.applies(record, config.riskAreas))?.reason ?? null

export const canGoBack = (state: State): boolean =>
  (state.stage === 'build' || state.stage === 'verify') && !state.merged && state.closed === null

const ARCHIVABLE: Stage[] = ['intake', 'brief', 'build', 'verify']

export const canArchive = (state: State): boolean =>
  state.closed === null && !state.merged && ARCHIVABLE.includes(state.stage)

const run = (stage: Stage, role: Role): Step => ({ kind: 'run', stage, role })
const wait = (on: WaitOn): Step => ({ kind: 'wait', on })
const question = (reason: string, options: string[]): Step => ({ kind: 'card', card: 'question', reason, options })

const learn: Rule = (record, state, config) => {
  if (state.stage !== 'done' || state.closed !== null || !state.accepted || state.learn.learned) return null
  if (!state.learn.corrected && !record.findings.some((finding) => finding.status === 'fixed')) return null
  if (state.run) return wait('run')
  if (state.failedRuns >= config.caps.failedRuns) {
    return { kind: 'emit', event: { type: 'learn.skipped', data: { reason: 'the Learn run failed twice' } } }
  }
  return run('done', 'reviewer')
}

const closed: Rule = (_r, state) => (state.closed !== null || state.stage === 'done' ? { kind: 'done' } : null)
const cardOpen: Rule = (_r, state) => (state.card ? wait('owner') : null)
const runLive: Rule = (_r, state) => (state.run ? wait('run') : null)
const failedRuns: Rule = (_r, state, config) =>
  state.failedRuns >= config.caps.failedRuns
    ? question('failed-runs', ['retry', 'retry-with-guidance', 'discard'])
    : null

const intake: Rule = (_r, state, config) => {
  if (state.stage !== 'intake') return null
  if (state.reporter.waiting) return wait('reporter')
  if (state.last === 'reporter.silent' && state.reporter.rounds >= config.caps.reporterRounds) {
    return question('reporter-silent', ['close', 'ask-again', 'accept'])
  }
  if (state.last === 'intake.disputed') return question('disputed', ['not-a-bug', 'accept', 'ask-again'])
  return run('intake', 'builder')
}

const approvedByRule: EventOf<'brief.approved'> = { type: 'brief.approved', data: { by: 'rule' } }

const brief: Rule = (record, state, config) => {
  if (state.stage !== 'brief') return null
  if (state.brief === 'none' || state.note !== null) return run('brief', 'builder')
  const reason = briefGate(record, config) ?? (state.returned ? 'sent-back' : null)
  if (reason === null) return { kind: 'emit', event: approvedByRule }
  return { kind: 'card', card: 'brief', reason, options: [] }
}

const build: Rule = (_r, state, config) => {
  if (state.stage !== 'build') return null
  if (state.verifyRounds >= config.caps.verifyRounds + state.extraRounds) {
    return question('verify-rounds', ['one-more-round', 'accept-as-is', 'discard'])
  }
  return run('build', 'builder')
}

const author: Rule = (_r, state, config) => {
  if (state.stage !== 'verify' || !state.waitingAuthor) return null
  if (state.verifyRounds >= config.caps.verifyRounds + state.extraRounds) {
    return question('verify-rounds', ['one-more-round', 'accept-as-is', 'discard'])
  }
  return wait('author')
}

const verify: Rule = (_r, state) => {
  if (state.stage !== 'verify') return null
  if (state.reviewed !== (state.patch?.id ?? null)) return run('verify', 'reviewer')
  return state.checks === 'pending' ? wait('checks') : run('verify', 'verifier')
}

const resultCard: Step = { kind: 'card', card: 'result', reason: 'result', options: [] }

const afterMerge = (state: State, config: Config): Step => {
  if (config.deployChecks && !state.deployed) {
    return state.deployStalled ? question('deploy-stalled', ['check-again', 'continue']) : wait('deploy')
  }
  if (!state.accepted) return resultCard
  if (config.productionGate && !state.productionApproved) {
    return state.productionHeld ? wait('owner') : question('production', ['approve', 'hold'])
  }
  return { kind: 'done' }
}

const ship: Rule = (_r, state, config) => {
  if (state.stage !== 'ship') return null
  if (state.adopted && !state.accepted) return resultCard
  return state.merged ? afterMerge(state, config) : { kind: 'effect', effect: 'merge' }
}

const RULES: Rule[] = [learn, closed, cardOpen, runLive, failedRuns, intake, brief, build, author, verify, ship]

export const next = (record: TicketRecord, state: State, config: Config): Step => {
  for (const rule of RULES) {
    const step = rule(record, state, config)
    if (step) return step
  }
  return { kind: 'done' }
}
