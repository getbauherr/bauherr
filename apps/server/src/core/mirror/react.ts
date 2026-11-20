import type { AppEvent, Stage } from '../events'
import type { State } from '../fold'
import { DISCLOSURE } from '../forge/disclosure'
import type { TicketRecord } from '../record/schema'

export type ReactItem = { state: 'open' | 'closed' | 'merged'; headSha: string | null; mergeSha: string | null }
export type ReactComment = { author: string; body: string; createdAt: string }
export type ReactCheck = { status: string; conclusion: string | null }

export type ReactInput = {
  record: TicketRecord
  state: State
  postedAt: string | null
  issue: ReactItem
  pull: ReactItem | null
  comments: ReactComment[]
  checks: ReactCheck[]
}

export type Reaction = (input: ReactInput) => AppEvent[]

const PASSING = ['success', 'neutral', 'skipped']

const isFactory = (comment: ReactComment): boolean => comment.body.trimStart().startsWith(DISCLOSURE)

export const reporterReplied: Reaction = ({ record, state, postedAt, comments }) => {
  if (!state.reporter.waiting || postedAt === null) return []
  const replied = comments.some(
    (comment) =>
      comment.author === record.source.reporter &&
      !isFactory(comment) &&
      Date.parse(comment.createdAt) > Date.parse(postedAt),
  )
  return replied ? [{ type: 'reporter.replied', data: {} }] : []
}

export const checksState = (checks: ReactCheck[]): 'pending' | 'passed' | 'failed' => {
  if (checks.length === 0 || checks.some((check) => check.status !== 'completed')) return 'pending'
  const passed = checks.every((check) => check.conclusion !== null && PASSING.includes(check.conclusion))
  return passed ? 'passed' : 'failed'
}

export const checksFinished: Reaction = ({ state, pull, checks }) => {
  const patch = state.patch
  if (state.checks !== 'pending' || patch === null || pull === null || pull.headSha !== patch.headSha) return []
  const outcome = checksState(checks)
  if (outcome === 'pending') return []
  return [{ type: 'checks.finished', data: { patchId: patch.id, passed: outcome === 'passed' } }]
}

const mergeStages = (state: State): Stage[] => (state.adopted ? ['verify', 'ship'] : ['ship'])

export const pullMerged: Reaction = ({ state, pull }) => {
  if (!mergeStages(state).includes(state.stage) || state.merged) return []
  if (pull?.state !== 'merged' || pull.mergeSha === null) return []
  return [{ type: 'ship.merged', data: { sha: pull.mergeSha } }]
}

export const issueClosed: Reaction = ({ state, issue, pull }) => {
  const mergedPull = state.adopted && pull?.state === 'merged'
  const settled =
    state.closed !== null || state.merged || mergedPull || state.stage === 'ship' || state.stage === 'done'
  if (settled || issue.state !== 'closed') return []
  return [{ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }]
}

export const pullClosed: Reaction = ({ state, pull }) =>
  state.adopted && pull?.state === 'closed' ? [{ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }] : []

export const headMoved: Reaction = ({ state, pull }) => {
  const patch = state.patch
  if (!state.adopted || patch === null || pull?.state !== 'open') return []
  if (pull.headSha === null || pull.headSha === patch.headSha) return []
  const data = { pr: patch.pr, headSha: pull.headSha, patchId: `adopted:${pull.headSha}` }
  return [{ type: 'pull.adopted', data }]
}

const REACTIONS: Reaction[] = [reporterReplied, checksFinished, pullMerged, headMoved]

export const react = (input: ReactInput): AppEvent[] => {
  const closed = [...pullClosed(input), ...issueClosed(input)]
  if (closed.length > 0) return closed.slice(0, 1)
  return REACTIONS.flatMap((reaction) => reaction(input))
}
