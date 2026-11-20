import type { AppEvent } from '../events'
import type { State } from '../fold'
import { DISCLOSURE } from '../forge/disclosure'
import type { TicketRecord } from '../record/schema'

export type ReactItem = { state: 'open' | 'closed' | 'merged'; headSha: string | null; mergeSha: string | null }
export type ReactComment = { author: string; body: string; createdAt: string }
export type ReactCheck = { status: string; conclusion: string | null }

export type ReactInput = {
  record: TicketRecord
  state: State
  askedAt: string | null
  issue: ReactItem
  pull: ReactItem | null
  comments: ReactComment[]
  checks: ReactCheck[]
}

export type Reaction = (input: ReactInput) => AppEvent[]

const PASSING = ['success', 'neutral', 'skipped']

const isFactory = (comment: ReactComment): boolean => comment.body.trimStart().startsWith(DISCLOSURE)

export const reporterReplied: Reaction = ({ record, state, askedAt, comments }) => {
  if (!state.reporter.waiting || askedAt === null) return []
  const replied = comments.some(
    (comment) =>
      comment.author === record.source.reporter &&
      !isFactory(comment) &&
      Date.parse(comment.createdAt) > Date.parse(askedAt),
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

export const pullMerged: Reaction = ({ state, pull }) => {
  if (state.stage !== 'ship' || state.merged || pull?.state !== 'merged' || pull.mergeSha === null) return []
  return [{ type: 'ship.merged', data: { sha: pull.mergeSha } }]
}

export const issueClosed: Reaction = ({ state, issue }) => {
  const settled = state.closed !== null || state.merged || state.stage === 'ship' || state.stage === 'done'
  if (settled || issue.state !== 'closed') return []
  return [{ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }]
}

const REACTIONS: Reaction[] = [reporterReplied, checksFinished, pullMerged]

export const react = (input: ReactInput): AppEvent[] => {
  const closed = issueClosed(input)
  if (closed.length > 0) return closed
  return REACTIONS.flatMap((reaction) => reaction(input))
}
