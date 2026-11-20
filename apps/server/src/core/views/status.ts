import type { Stage } from '../events'
import type { StoredCard, WaitingOn } from '../record/store'

export const STUCK_REASONS = ['failed-runs', 'verify-rounds', 'reporter-silent'] as const

export const isStuck = (card: Pick<StoredCard, 'card' | 'reason'> | null): boolean =>
  card !== null && card.card === 'question' && (STUCK_REASONS as readonly string[]).includes(card.reason)

export const STATES = ['owner', 'agents', 'stuck', 'others'] as const

export type TicketState = (typeof STATES)[number] | 'none'

export const stateOf = (input: { waitingOn: WaitingOn; stuck: boolean; hasRun: boolean }): TicketState => {
  if (input.stuck) return 'stuck'
  if (input.waitingOn === 'owner') return 'owner'
  if (input.waitingOn === 'agents' && input.hasRun) return 'agents'
  return input.waitingOn === 'nobody' ? 'none' : 'others'
}

export const STATUSES = [
  'triaging',
  'drafting-brief',
  'building',
  'verifying',
  'queued',
  'waiting-for-checks',
  'waiting-for-deploy',
  'reporter-asked',
  'brief-needs-approval',
  'result-ready',
  'question',
  'failed-runs',
  'verify-rounds',
  'reporter-silent',
  'parked',
  'accepted',
  'closed',
] as const

export type TicketStatus = (typeof STATUSES)[number]

export type StatusInput = {
  stage: Stage
  waitingOn: WaitingOn
  card: StoredCard | null
  parked: string | null
  hasRun: boolean
  claimed: boolean
  ended: 'accepted' | 'closed' | null
}

const RUNNING: Record<Stage, TicketStatus> = {
  intake: 'triaging',
  brief: 'drafting-brief',
  build: 'building',
  verify: 'verifying',
  ship: 'waiting-for-deploy',
  done: 'closed',
}

const OPEN_CARD: Record<StoredCard['card'], TicketStatus> = {
  brief: 'brief-needs-approval',
  result: 'result-ready',
  question: 'question',
}

type Rule = (input: StatusInput) => TicketStatus | null

const RULES: Rule[] = [
  (i) => i.ended,
  (i) => (i.parked === null ? null : 'parked'),
  (i) => STUCK_REASONS.find((reason) => isStuck(i.card) && i.card?.reason === reason) ?? null,
  (i) => (i.card === null ? null : OPEN_CARD[i.card.card]),
  (i) => (i.waitingOn === 'reporter' ? 'reporter-asked' : null),
  (i) => (i.hasRun && !i.claimed ? 'queued' : null),
  (i) => (i.stage === 'verify' && !i.hasRun ? 'waiting-for-checks' : null),
  (i) => (i.stage === 'ship' && !i.hasRun ? 'waiting-for-deploy' : null),
]

export const statusOf = (input: StatusInput): TicketStatus => {
  for (const rule of RULES) {
    const status = rule(input)
    if (status !== null) return status
  }
  return RUNNING[input.stage]
}
