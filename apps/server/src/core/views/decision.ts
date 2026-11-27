import { AGENT_ASK, BACK_TO_BRIEF, DECISIONS, DROP_CRITERIA, OWN_ANSWER, VERIFY_EXITS } from '../decisions'
import { canGoBack, type State } from '../lifecycle'
import type { DroppedCriterion, TicketRecord } from '../record/schema'
import type { StoredCard } from '../record/store'

export type DecisionView = {
  ask: string
  options: string[]
  recommended: string | null
  criteria: { id: string; text: string }[]
  dropped: DroppedCriterion[]
}

const askOf = (card: StoredCard): string => (card.card === 'question' ? `question:${card.reason}` : card.card)

const optionsOf = (ask: string, card: StoredCard, state: State): string[] => {
  if (ask === AGENT_ASK) {
    const own = canGoBack(state) ? [OWN_ANSWER, BACK_TO_BRIEF] : [OWN_ANSWER]
    return [...card.options, ...own]
  }
  return card.options.length > 0 ? card.options : Object.keys(DECISIONS[ask] ?? {})
}

const recommendedOf = (ask: string, options: string[]): string | null => {
  const first = options[0] ?? null
  return ask !== AGENT_ASK || (first !== null && VERIFY_EXITS.includes(first)) ? first : null
}

export const decisionOf = (card: StoredCard | null, record: TicketRecord, state: State): DecisionView | null => {
  if (card === null) return null
  const ask = askOf(card)
  const criteria = record.criteria.map(({ id, text }) => ({ id, text }))
  const droppable = criteria.length > 1
  const options = optionsOf(ask, card, state).filter((option) => droppable || option !== DROP_CRITERIA)
  return { ask, options, recommended: recommendedOf(ask, options), criteria, dropped: record.dropped }
}

export const unmetAccepted = (record: TicketRecord, state: State): string[] =>
  state.overridden
    ? record.criteria.filter((c) => c.status !== 'met' && c.status !== 'waived').map((c) => c.id)
    : []
