import { deployOverdue, type DeployWait } from '../deploy'
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
  deploy: DeployWait | null
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

const REACTIONS: Reaction[] = [reporterReplied, checksFinished, pullMerged, headMoved, deployFinished]

export const react = (input: ReactInput): AppEvent[] => {
  const closed = [...pullClosed(input), ...issueClosed(input)]
  if (closed.length > 0) return closed.slice(0, 1)
  return REACTIONS.flatMap((reaction) => reaction(input))
}
