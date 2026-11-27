import { DROP_CRITERIA, questionKey, withVerifyExits } from './decisions'
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

const submitted = (state: State, runId: string): State => ({ ...endRun(state, runId), failedRuns: 0, failure: null })

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
      return {
        ...endRun(state, event.data.runId),
        failedRuns: state.failedRuns + 1,
        failure: event.data.stage === 'brief' ? event.data.reason : state.failure,
      }
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
  rewriting: true,
  failure: null,
  note,
})

const brief: Reducer = (state, event) => {
  switch (event.type) {
    case 'brief.submitted':
      return { ...submitted(state, event.data.runId), brief: 'submitted', rewriting: false }
    case 'brief.approved':
      return { ...enter(state, state.adopted ? 'verify' : 'build'), brief: 'approved', returned: false }
    case 'brief.changes-requested':
      return state.brief === 'approved'
        ? backToBrief(state, event.data.note)
        : { ...state, note: event.data.note, rewriting: true, failure: null }
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
  }
}

const conflicted = (state: State, data: EventOf<'pull.conflicted'>['data']): State => {
  if (state.patch?.id !== data.patchId) return state
  const stale = { ...state, conflict: data, reviewed: null, verdict: null, accepted: false }
  if (state.adopted) return { ...enter(stale, 'verify'), waitingAuthor: true }
  return { ...enter(stale, 'build'), note: conflictNote(data.base) }
}

const updated: Reducer = (state, event, options) => {
  if (event.type !== 'pull.updated') return null
  const { data } = event
  if (state.patch?.id !== data.patchId) return state
  const verdict = state.verdict === null ? null : { ...state.verdict, headSha: data.headSha }
  const checks = options.requiredChecks === false ? 'none' : 'pending'
  return { ...state, patch: { ...state.patch, headSha: data.headSha }, verdict, checks }
}

const rebuilt = (state: State, data: EventOf<'build.submitted'>['data'], options: FoldOptions): State => {
  const fresh = {
    ...submitted(state, data.runId),
    merged: false,
    mergeSha: null,
    deployed: false,
    deployStalled: null,
    accepted: false,
    overridden: false,
  }
  const latest = { id: data.patchId, pr: data.pr, headSha: data.headSha }
  const checks = options.requiredChecks === false ? 'none' : 'pending'
  return { ...enter(fresh, 'verify'), patch: latest, reviewed: null, conflict: null, checks, verdict: null }
}

const patch: Reducer = (state, event, options) => {
  switch (event.type) {
    case 'build.submitted':
      return rebuilt(state, event.data, options)
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
  state.accepted && shipped(state, options) ? enter(state, 'done') : state

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
    default:
      return null
  }
}

const asked = (state: State, data: EventOf<'question.asked'>['data']): State => {
  const { reason, options, text } = data
  const key = text === undefined ? null : questionKey(text)
  const exits = reason === 'agent' && state.stage === 'verify' && state.patch !== null
  return {
    ...state,
    asked: key === null ? state.asked : [...state.asked, key],
    card: {
      card: 'question',
      reason,
      options: exits ? withVerifyExits(options, key !== null && state.asked.includes(key)) : options,
      ...(text === undefined ? {} : { text }),
    },
  }
}

const reverified = (state: State, option: string): State =>
  option === DROP_CRITERIA && state.card?.reason === 'verify-rounds'
    ? { ...enter(state, 'verify'), verifyRounds: Math.max(0, state.verifyRounds - 1), waitingAuthor: false }
    : state

const questions: Reducer = (state, event) => {
  switch (event.type) {
    case 'question.asked':
      return asked(state, event.data)
    case 'question.answered':
      return {
        ...reverified(state, event.data.option),
        card: null,
        failure: null,
        alreadyDone: null,
        deployStalled: null,
        failedRuns: 0,
        extraRounds: state.extraRounds + (event.data.option === 'one-more-round' ? 1 : 0),
      }
    default:
      return null
  }
}

const REDUCERS: Reducer[] = [intake, runs, owner, brief, patch, updated, verify, ship, questions]

const QUIET = new Set(['request.commented', 'run.comments.delivered'])

const RETIRED_QUESTIONS = ['production']

const isRetired = (event: AppEvent): boolean =>
  event.type === 'production.approved' ||
  event.type === 'production.held' ||
  (event.type === 'question.asked' && RETIRED_QUESTIONS.includes(event.data.reason))

export const reduce = (state: State, event: AppEvent, options: FoldOptions): State => {
  if (QUIET.has(event.type) || event.type.startsWith('forge.write.') || isRetired(event)) return state
  const next = REDUCERS.reduce<State | null>((found, reducer) => found ?? reducer(state, event, options), null)
  return { ...(next ?? state), last: event.type }
}

export const fold = (events: AppEvent[], options: FoldOptions = {}): State =>
  events.reduce((state, event) => reduce(state, event, options), initialState())
