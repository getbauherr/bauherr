import type { SteerOutcome } from '../../../core/steer/turn'
import type { Staged } from '../components/inbox/use-pending-decisions'
import { DROP_CRITERIA } from '../../../core/decisions'
import type { DecisionModel } from './inbox-decision'
import { RECEIPTS } from './inbox-words'

export const COMMENT_RECEIPT = 'Passed to the agent'
export const INTENT_TOOL = 'intent'
export const PROPOSAL_TOOL = 'proposal'

type Target = { recordId: number; number: number }

export const stagedOf = (target: Target, outcome: SteerOutcome, at: number): Staged | null => {
  if (outcome.kind === 'comment') {
    const key = `comment:${target.recordId}:${at}`
    return { key, ...target, receipt: COMMENT_RECEIPT, input: {}, comment: outcome.body, steered: true }
  }
  if (outcome.kind !== 'decide') return null
  const { input } = outcome
  const dropped = `Dropped ${(input.criteria ?? []).join(', ')}`
  const receipt = input.choice === DROP_CRITERIA ? dropped : (RECEIPTS[input.choice] ?? input.choice)
  return { key: `${input.recordId}:${input.ask}:${input.seq}`, ...target, receipt, input, steered: true }
}

type Decide = Extract<SteerOutcome, { kind: 'decide' }>
type Body = Decide | { kind: 'comment'; body: string }

export type Proposal = Body & { id: string; recordId: number; number: number; model: DecisionModel | null }

export const proposalOf = (
  target: Target,
  model: DecisionModel | null,
  outcome: SteerOutcome,
  id: string,
): Proposal | null =>
  outcome.kind === 'decide' || outcome.kind === 'comment' ? { ...outcome, ...target, model, id } : null
