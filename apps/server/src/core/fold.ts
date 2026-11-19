import type { AppEvent, EventType, Stage } from './events'

export type Card = { card: 'question'; reason: string; options: string[]; text?: string }
export type Verdict = { patchId: string; headSha: string }
export type LiveRun = { stage: Stage; runId: string; fingerprint: string }

export type State = {
  stage: Stage
  closed: string | null
  card: Card | null
  run: LiveRun | null
  reporter: { rounds: number; waiting: boolean }
  verifyRounds: number
  extraRounds: number
  failedRuns: number
  brief: 'none' | 'submitted' | 'approved'
  patch: { id: string; pr: number; headSha: string } | null
  checks: 'none' | 'pending' | 'passed' | 'failed'
  verdict: Verdict | null
  overridden: boolean
  merged: boolean
  deployed: boolean
  accepted: boolean
  productionApproved: boolean
  productionHeld: boolean
  note: string | null
  last: EventType | null
}

export type FoldOptions = { productionGate: boolean }

export const initialState = (): State => ({
  stage: 'intake',
  closed: null,
  card: null,
  run: null,
  reporter: { rounds: 0, waiting: false },
  verifyRounds: 0,
  extraRounds: 0,
  failedRuns: 0,
  brief: 'none',
  patch: null,
  checks: 'none',
  verdict: null,
  overridden: false,
  merged: false,
  deployed: false,
  accepted: false,
  productionApproved: false,
  productionHeld: false,
  note: null,
  last: null,
})

type Reducer = (state: State, event: AppEvent, options: FoldOptions) => State | null

const enter = (state: State, stage: Stage): State =>
  stage === state.stage ? state : { ...state, stage, failedRuns: 0 }

const endRun = (state: State, runId: string): State =>
  state.run?.runId === runId ? { ...state, run: null } : state

const submitted = (state: State, runId: string): State => ({ ...endRun(state, runId), failedRuns: 0 })

const endIntakeRun = (state: State): State =>
  state.run?.stage === 'intake' ? submitted(state, state.run.runId) : state

const intake: Reducer = (state, event) => {
  switch (event.type) {
    case 'intake.accepted':
      return enter(endIntakeRun(state), 'brief')
    case 'intake.asked':
      return { ...endIntakeRun(state), reporter: { rounds: event.data.round, waiting: true } }
    case 'intake.disputed':
      return endIntakeRun(state)
    case 'reporter.replied':
    case 'reporter.silent':
      return { ...state, reporter: { ...state.reporter, waiting: false } }
    case 'intake.closed':
      return { ...state, closed: event.data.reason }
    default:
      return null
  }
}

const runs: Reducer = (state, event) => {
  switch (event.type) {
    case 'run.started':
      return { ...state, run: event.data, note: null }
    case 'run.failed':
      return { ...endRun(state, event.data.runId), failedRuns: state.failedRuns + 1 }
    case 'run.released':
      return endRun(state, event.data.runId)
    default:
      return null
  }
}

const owner: Reducer = (state, event) => {
  switch (event.type) {
    case 'owner.note':
      return { ...state, note: event.data.note }
    case 'ticket.closed':
      return { ...state, closed: event.data.reason }
    default:
      return null
  }
}

const brief: Reducer = (state, event) => {
  switch (event.type) {
    case 'brief.submitted':
      return { ...submitted(state, event.data.runId), brief: 'submitted' }
    case 'brief.approved':
      return { ...enter(state, 'build'), brief: 'approved' }
    case 'brief.changes-requested':
      return { ...state, note: event.data.note }
    case 'brief.discarded':
      return { ...state, closed: 'discarded' }
    default:
      return null
  }
}

const patch: Reducer = (state, event) => {
  switch (event.type) {
    case 'build.submitted': {
      const fresh = {
        ...submitted(state, event.data.runId),
        merged: false,
        deployed: false,
        accepted: false,
        productionHeld: false,
        overridden: false,
      }
      const latest = { id: event.data.patchId, pr: event.data.pr, headSha: event.data.headSha }
      return { ...enter(fresh, 'verify'), patch: latest, checks: 'pending', verdict: null }
    }
    case 'checks.finished':
      if (state.patch?.id !== event.data.patchId) return state
      return { ...state, checks: event.data.passed ? 'passed' : 'failed' }
    default:
      return null
  }
}

const verdictOf = (data: Verdict): Verdict => ({ patchId: data.patchId, headSha: data.headSha })

const verify: Reducer = (state, event) => {
  switch (event.type) {
    case 'verify.passed':
      return { ...enter(submitted(state, event.data.runId), 'ship'), verdict: verdictOf(event.data) }
    case 'verify.overridden':
      if (state.patch?.id !== event.data.patchId) return state
      return { ...enter({ ...state, failedRuns: 0 }, 'ship'), verdict: verdictOf(event.data), overridden: true }
    case 'verify.changes':
      return {
        ...enter(submitted(state, event.data.runId), 'build'),
        verifyRounds: state.verifyRounds + 1,
        verdict: null,
      }
    default:
      return null
  }
}

const finished = (state: State, options: FoldOptions): State =>
  state.accepted && (!options.productionGate || state.productionApproved) ? enter(state, 'done') : state

const ship: Reducer = (state, event, options) => {
  switch (event.type) {
    case 'ship.merged':
      return { ...state, merged: true }
    case 'ship.deployed':
      return { ...state, deployed: true }
    case 'result.accepted':
      return finished({ ...state, accepted: true }, options)
    case 'result.sent-back':
      return { ...enter(state, 'build'), accepted: false, note: event.data.note }
    case 'production.approved':
      return finished({ ...state, productionApproved: true }, options)
    case 'production.held':
      return { ...state, productionHeld: true }
    default:
      return null
  }
}

const questions: Reducer = (state, event) => {
  switch (event.type) {
    case 'question.asked':
      return {
        ...state,
        card: {
          card: 'question',
          reason: event.data.reason,
          options: event.data.options,
          ...(event.data.text === undefined ? {} : { text: event.data.text }),
        },
      }
    case 'question.answered':
      return {
        ...state,
        card: null,
        failedRuns: 0,
        extraRounds: state.extraRounds + (event.data.option === 'one-more-round' ? 1 : 0),
      }
    default:
      return null
  }
}

const REDUCERS: Reducer[] = [intake, runs, owner, brief, patch, verify, ship, questions]

const reduce = (state: State, event: AppEvent, options: FoldOptions): State => {
  if (event.type.startsWith('forge.write.')) return state
  for (const reducer of REDUCERS) {
    const next = reducer(state, event, options)
    if (next) return { ...next, last: event.type }
  }
  return { ...state, last: event.type }
}

export const fold = (events: AppEvent[], options: FoldOptions = { productionGate: false }): State =>
  events.reduce((state, event) => reduce(state, event, options), initialState())
