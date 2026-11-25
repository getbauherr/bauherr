import { conflictNote } from './conflict-note'
import type { AppEvent, EventOf, Stage } from './events'
import { initialState, type FoldOptions, type State, type Verdict } from './state'

export { initialState }
export type { Card, FoldOptions, LiveRun, State, Verdict } from './state'

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
      return { ...endIntakeRun(state), reporter: { rounds: event.data.round, waiting: true, reminded: false } }
    case 'intake.disputed':
      return endIntakeRun(state)
    case 'reporter.reminded':
      return { ...state, reporter: { ...state.reporter, reminded: true } }
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
    case 'run.expired':
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
    case 'ticket.restored':
      return state.closed === 'archived' || state.closed === 'closed-on-forge'
        ? { ...state, closed: null, card: null, run: null, failedRuns: 0, sentBackAfterMerge: false }
        : state
    case 'ticket.done-elsewhere':
      return enter(state, 'done')
    case 'ticket.blocked':
      return { ...state, blockedReason: event.data.reason }
    default:
      return null
  }
}

const backToBrief = (state: State, note: string): State => ({
  ...enter(state, 'brief'),
  brief: 'submitted',
  returned: true,
  card: null,
  run: null,
  verifyRounds: 0,
  extraRounds: 0,
  note,
})

const brief: Reducer = (state, event) => {
  switch (event.type) {
    case 'brief.submitted':
      return { ...submitted(state, event.data.runId), brief: 'submitted' }
    case 'brief.approved':
      return { ...enter(state, state.adopted ? 'verify' : 'build'), brief: 'approved', returned: false }
    case 'brief.changes-requested':
      return state.brief === 'approved' ? backToBrief(state, event.data.note) : { ...state, note: event.data.note }
    case 'brief.discarded':
      return { ...state, closed: 'discarded' }
    default:
      return null
  }
}

const adopt = (state: State, data: EventOf<'pull.adopted'>['data'], options: FoldOptions): State => {
  const stage = state.stage === 'intake' || state.stage === 'brief' ? 'brief' : 'verify'
  return {
    ...enter(state, stage),
    adopted: true,
    waitingAuthor: false,
    patch: { id: data.patchId, pr: data.pr, headSha: data.headSha },
    reviewed: null,
    conflict: null,
    checks: options.requiredChecks === false ? 'none' : 'pending',
    verdict: null,
    accepted: false,
    overridden: false,
    productionHeld: false,
  }
}

const conflicted = (state: State, data: EventOf<'pull.conflicted'>['data']): State => {
  if (state.patch?.id !== data.patchId) return state
  const stale = { ...state, conflict: data, reviewed: null, verdict: null, accepted: false }
  if (state.adopted) return { ...enter(stale, 'verify'), waitingAuthor: true }
  return { ...enter(stale, 'build'), note: conflictNote(data.base) }
}

const patch: Reducer = (state, event, options) => {
  switch (event.type) {
    case 'build.submitted': {
      const fresh = {
        ...submitted(state, event.data.runId),
        merged: false,
        mergeSha: null,
        deployed: false,
        deployStalled: null,
        accepted: false,
        productionHeld: false,
        overridden: false,
      }
      const latest = { id: event.data.patchId, pr: event.data.pr, headSha: event.data.headSha }
      const checks = options.requiredChecks === false ? 'none' : 'pending'
      return { ...enter(fresh, 'verify'), patch: latest, reviewed: null, conflict: null, checks, verdict: null }
    }
    case 'build.already-done': {
      const { by, evidence } = event.data
      return { ...submitted(state, event.data.runId), alreadyDone: { by, evidence } }
    }
    case 'pull.adopted':
      return adopt(state, event.data, options)
    case 'pull.conflicted':
      return conflicted(state, event.data)
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
    case 'review.submitted':
      return { ...submitted(state, event.data.runId), reviewed: event.data.patchId }
    case 'verify.passed':
      return {
        ...enter(submitted(state, event.data.runId), 'ship'),
        verdict: verdictOf(event.data),
        waitingAuthor: false,
      }
    case 'verify.overridden':
      if (state.patch?.id !== event.data.patchId) return state
      return {
        ...enter({ ...state, failedRuns: 0 }, 'ship'),
        verdict: verdictOf(event.data),
        overridden: true,
        waitingAuthor: false,
      }
    case 'verify.changes': {
      const rounded = { ...submitted(state, event.data.runId), verifyRounds: state.verifyRounds + 1, verdict: null }
      return state.adopted ? { ...rounded, waitingAuthor: true } : enter(rounded, 'build')
    }
    default:
      return null
  }
}

const shipped = (state: State, options: FoldOptions): boolean =>
  !state.adopted || (state.merged && (options.deployChecks !== true || state.deployed))

const finished = (state: State, options: FoldOptions): State =>
  state.accepted && shipped(state, options) && (!options.productionGate || state.productionApproved)
    ? enter(state, 'done')
    : state

const merged = (state: State, sha: string, options: FoldOptions): State => {
  if (!state.adopted) return { ...state, merged: true, mergeSha: sha }
  const entered = state.stage === 'verify' ? enter(state, 'ship') : state
  return finished({ ...entered, merged: true, mergeSha: sha }, options)
}

const sentBack = (state: State, note: string): State => {
  const after = { sentBackAfterMerge: state.sentBackAfterMerge || state.merged }
  if (!state.adopted) return { ...enter(state, 'build'), ...after, accepted: false, note }
  if (state.merged) return { ...enter(state, 'build'), ...after, adopted: false, accepted: false, verdict: null, note }
  return { ...enter(state, 'verify'), accepted: false, verdict: null, waitingAuthor: true, note }
}

const ship: Reducer = (state, event, options) => {
  switch (event.type) {
    case 'ship.merged':
      return merged(state, event.data.sha, options)
    case 'ship.deploy-stalled':
      return { ...state, deployStalled: { reason: event.data.reason, checks: event.data.checks } }
    case 'ship.deployed': {
      const deployed = { ...state, deployed: true, deployStalled: null }
      return state.adopted ? finished(deployed, options) : deployed
    }
    case 'result.accepted':
      return finished({ ...state, accepted: true, sentBackAfterMerge: false }, options)
    case 'result.sent-back':
      return sentBack(state, event.data.note)
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
        alreadyDone: null,
        deployStalled: null,
        failedRuns: 0,
        extraRounds: state.extraRounds + (event.data.option === 'one-more-round' ? 1 : 0),
      }
    default:
      return null
  }
}

const REDUCERS: Reducer[] = [intake, runs, owner, brief, patch, verify, ship, questions]

export const reduce = (state: State, event: AppEvent, options: FoldOptions): State => {
  if (event.type.startsWith('forge.write.') || event.type === 'request.commented') return state
  const next = REDUCERS.reduce<State | null>((found, reducer) => found ?? reducer(state, event, options), null)
  return { ...(next ?? state), last: event.type }
}

export const fold = (events: AppEvent[], options: FoldOptions = { productionGate: false }): State =>
  events.reduce((state, event) => reduce(state, event, options), initialState())
