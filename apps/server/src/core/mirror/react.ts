import { deployOverdue, type DeployWait } from '../deploy'
import type { AppEvent, Stage } from '../events'
import type { State } from '../fold'
import { DISCLOSURE } from '../forge/disclosure'
import type { TicketRecord } from '../record/schema'

export type ReactItem = {
  state: 'open' | 'closed' | 'merged'
  headSha: string | null
  mergeSha: string | null
  baseRef: string | null
  conflicts: boolean
}
export type ReactComment = { author: string; body: string; createdAt: string }
export type ReactCheck = { name: string; status: string; conclusion: string | null }

export type ReactInput = {
  record: TicketRecord
  state: State
  postedAt: string | null
  issue: ReactItem
  pull: ReactItem | null
  comments: ReactComment[]
  checks: ReactCheck[]
  requiredNames?: string[]
  deploy: DeployWait | null
  closeWritten: boolean
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

const isPassing = (check: ReactCheck): boolean => check.conclusion !== null && PASSING.includes(check.conclusion)

const requiredState = (checks: ReactCheck[], names: string[]): 'pending' | 'passed' | 'failed' => {
  const reported = names.map((name) => checks.filter((check) => check.name === name))
  const failed = (check: ReactCheck): boolean => check.status === 'completed' && !isPassing(check)
  if (reported.some((group) => group.some(failed))) return 'failed'
  const settled = reported.every((group) => group.length > 0 && group.every((check) => check.status === 'completed'))
  return settled ? 'passed' : 'pending'
}

export const checksState = (checks: ReactCheck[], requiredNames: string[] = []): 'pending' | 'passed' | 'failed' => {
  if (requiredNames.length > 0) return requiredState(checks, requiredNames)
  if (checks.length === 0 || checks.some((check) => check.status !== 'completed')) return 'pending'
  const passed = checks.every(isPassing)
  return passed ? 'passed' : 'failed'
}

export const checksFinished: Reaction = ({ state, pull, checks, requiredNames = [] }) => {
  const patch = state.patch
  if (state.checks !== 'pending' || patch === null || pull === null || pull.headSha !== patch.headSha) return []
  const outcome = checksState(checks, requiredNames)
  if (outcome === 'pending') return []
  return [{ type: 'checks.finished', data: { patchId: patch.id, passed: outcome === 'passed' } }]
}

const CONFLICT_STAGES: Stage[] = ['verify', 'ship']

const conflictBase = (pull: ReactItem | null, state: State): string | null => {
  if (pull?.state !== 'open' || !pull.conflicts) return null
  return state.adopted && pull.headSha !== state.patch?.headSha ? null : pull.baseRef
}

export const pullConflicted: Reaction = ({ state, pull }) => {
  const { patch } = state
  const base = conflictBase(pull, state)
  if (patch === null || base === null || state.merged || !CONFLICT_STAGES.includes(state.stage)) return []
  return state.conflict?.patchId === patch.id ? [] : [{ type: 'pull.conflicted', data: { patchId: patch.id, base } }]
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
    state.closed !== null ||
    state.merged ||
    state.sentBackAfterMerge ||
    mergedPull ||
    state.stage === 'ship' ||
    state.stage === 'done'
  if (settled || issue.state !== 'closed') return []
  return [{ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }]
}

export const pullClosed: Reaction = ({ state, pull }) =>
  state.adopted && pull?.state === 'closed' ? [{ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }] : []

const reopenable = ({ state, pull, closeWritten }: ReactInput): boolean => {
  if (state.closed === 'archived') return closeWritten
  return state.closed === 'closed-on-forge' && !(state.adopted && pull?.state === 'closed')
}

export const issueReopened: Reaction = (input) =>
  reopenable(input) && input.issue.state === 'open' ? [{ type: 'ticket.restored', data: {} }] : []

export const headMoved: Reaction = ({ state, pull }) => {
  const patch = state.patch
  if (!state.adopted || patch === null || pull?.state !== 'open') return []
  if (pull.headSha === null || pull.headSha === patch.headSha) return []
  const data = { pr: patch.pr, headSha: pull.headSha, patchId: `adopted:${pull.headSha}` }
  return [{ type: 'pull.adopted', data }]
}

type DeployResult = 'success' | 'failure' | 'none'

const deployResult = (wait: DeployWait, name: string): DeployResult => {
  const check = wait.checks.find((candidate) => candidate.name === name)
  if (check?.status !== 'completed') return 'none'
  if (check.conclusion !== null && PASSING.includes(check.conclusion)) return 'success'
  return Date.parse(check.updatedAt) > Date.parse(wait.since) ? 'failure' : 'none'
}

export const deployFinished: Reaction = ({ deploy }) => {
  if (deploy === null) return []
  const results = deploy.names.map((name) => ({ name, result: deployResult(deploy, name) }))
  const namesOf = (result: DeployResult) => results.filter((r) => r.result === result).map((r) => r.name)
  const failed = namesOf('failure')
  if (failed.length > 0) return [{ type: 'ship.deploy-stalled', data: { reason: 'failed', checks: failed } }]
  if (namesOf('success').length === results.length) return [{ type: 'ship.deployed', data: {} }]
  if (!deployOverdue(deploy.since, deploy.now, deploy.limitMinutes)) return []
  return [{ type: 'ship.deploy-stalled', data: { reason: 'overdue', checks: namesOf('none') } }]
}

const REACTIONS: Reaction[] = [reporterReplied, checksFinished, pullConflicted, pullMerged, headMoved, deployFinished]

export const react = (input: ReactInput): AppEvent[] => {
  if (input.state.closed === 'archived' || input.state.closed === 'closed-on-forge') return issueReopened(input)
  const closed = [...pullClosed(input), ...issueClosed(input)]
  if (closed.length > 0) return closed.slice(0, 1)
  return REACTIONS.flatMap((reaction) => reaction(input))
}
