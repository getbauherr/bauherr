import type { SteerOutcome } from '../../../core/steer/turn'
import type { Staged } from '../components/inbox/use-pending-decisions'
import { DROP_CRITERIA } from '../../../core/decisions'
import { RECEIPTS } from './inbox-words'

export const COMMENT_RECEIPT = 'Passed to the agent'
export const INTENT_TOOL = 'intent'

type Target = { recordId: number; number: number }

export const stagedOf = (target: Target, outcome: SteerOutcome, at: number): Staged | null => {
  if (outcome.kind === 'comment') {
    const key = `comment:${target.recordId}:${at}`
    return { key, ...target, receipt: COMMENT_RECEIPT, input: {}, comment: outcome.body }
  }
  if (outcome.kind !== 'decide') return null
  const { input } = outcome
  const dropped = `Dropped ${(input.criteria ?? []).join(', ')}`
  const receipt = input.choice === DROP_CRITERIA ? dropped : (RECEIPTS[input.choice] ?? input.choice)
  return { key: `${input.recordId}:${input.ask}:${input.seq}`, ...target, receipt, input }
}
