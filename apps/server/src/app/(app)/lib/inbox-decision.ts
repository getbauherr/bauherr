import { DROP_CRITERIA } from '../../../core/decisions'
import type { StoredCard } from '../../../core/record/store'
import type { DecisionView } from '../../../core/views/decision'
import type { TicketView } from '../../../core/views/ticket'
import { GHOST_CHOICES, HEADLINES, OPTIONAL_NOTE, PRIMARY_CHOICE, RESULT_REASON } from './inbox-words'
import { CHOICE_WORDS, NOTE_PROMPTS, NOTE_SAYS, REASON_WORDS } from './ticket-words'

export type DecisionSource = Pick<TicketView, 'recordId' | 'number' | 'card' | 'record' | 'decision' | 'acceptedUnmet'>

export type Tier = 'primary' | 'secondary' | 'ghost'
export type NoteSpec = { prompt: string; say: string; required: boolean }
export type DecisionOption = { choice: string; label: string; tier: Tier; note: NoteSpec | null; criteria: boolean }
export type CriterionRow = { id: string; text: string }
export type CriteriaModel = { active: CriterionRow[]; dropped: CriterionRow[]; suggested: string[] }
export type OpenAnswer = {
  id: string
  question: string
  recommended: string
  options: { id: string; label: string }[]
}

export type DecisionModel = {
  key: string
  recordId: number
  number: number
  ask: string
  seq: number
  headline: string
  reason: string
  options: DecisionOption[]
  criteria: CriteriaModel | null
  answers: OpenAnswer[]
}

export const askOf = (card: Pick<StoredCard, 'card' | 'reason'>): string =>
  card.card === 'question' ? `question:${card.reason}` : card.card

const exceptionsOf = (view: DecisionSource): string => {
  const dropped = view.record.dropped.map((row) => row.id)
  const dropping = dropped.length > 0 ? ` Dropped by you: ${dropped.join(', ')}.` : ''
  const unmet = view.acceptedUnmet.length > 0 ? ` Not met, accepted by you: ${view.acceptedUnmet.join(', ')}.` : ''
  return `${RESULT_REASON}${dropping}${unmet}`
}

const reasonOf = (card: StoredCard, view: DecisionSource): string => {
  if (card.card === 'result') return exceptionsOf(view)
  if (card.reason === 'agent') return card.text ?? REASON_WORDS.agent
  if (card.reason === 'parked') return `${REASON_WORDS.parked}: ${card.text ?? ''}`
  return REASON_WORDS[card.reason as keyof typeof REASON_WORDS] ?? card.reason
}

const headlineOf = (card: StoredCard, number: number): string => {
  if (card.reason === 'agent') return card.text ?? 'The agent has a question'
  const key = card.card === 'question' ? card.reason : card.card
  return (HEADLINES[key] ?? 'What should the factory do on #{n}?').replace('{n}', String(number))
}

const primaryOf = (card: StoredCard, decision: DecisionView): string => {
  const key = card.card === 'question' ? card.reason : card.card
  const fixed = PRIMARY_CHOICE[key]
  const wanted = card.card === 'question' ? [decision.recommended, fixed] : [fixed, decision.recommended]
  return wanted.find((choice) => choice != null && decision.options.includes(choice)) ?? decision.options[0] ?? ''
}

const noteOf = (ask: string, choice: string): NoteSpec | null => {
  if (choice === DROP_CRITERIA) return { prompt: OPTIONAL_NOTE, say: 'Add a reason', required: false }
  const prompt = NOTE_PROMPTS[`${ask}/${choice}`]
  if (prompt) return { prompt, say: NOTE_SAYS[`${ask}/${choice}`] ?? 'Write a comment', required: true }
  return GHOST_CHOICES.includes(choice) ? { prompt: OPTIONAL_NOTE, say: 'Add a reason', required: false } : null
}

const tierOf = (choice: string, primary: string): Tier => {
  if (choice === primary) return 'primary'
  return GHOST_CHOICES.includes(choice) ? 'ghost' : 'secondary'
}

const optionsOf = (card: StoredCard, decision: DecisionView): DecisionOption[] => {
  const { ask } = decision
  const primary = primaryOf(card, decision)
  const order = ['primary', 'secondary', 'ghost']
  return decision.options
    .map((choice): DecisionOption => ({
      choice,
      label: CHOICE_WORDS[ask]?.[choice] ?? choice,
      tier: tierOf(choice, primary),
      note: noteOf(ask, choice),
      criteria: choice === DROP_CRITERIA,
    }))
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
}

const UNMET = ['open', 'missing', 'partial']

export const criteriaOf = (view: DecisionSource, decision: DecisionView): CriteriaModel | null => {
  if (!decision.options.includes(DROP_CRITERIA)) return null
  const status = new Map(view.record.criteria.map((row) => [row.id, row.status]))
  return {
    active: decision.criteria,
    dropped: decision.dropped.map(({ id, text }) => ({ id, text })),
    suggested: decision.criteria.filter((row) => UNMET.includes(status.get(row.id) ?? '')).map((row) => row.id),
  }
}

const answersOf = (view: DecisionSource, card: StoredCard): OpenAnswer[] =>
  card.card !== 'brief'
    ? []
    : view.record.decisions
        .filter((decision) => decision.answer === undefined)
        .map((decision) => ({
          id: decision.id,
          question: decision.question,
          recommended: decision.recommended,
          options: decision.options.map(({ id, label }) => ({ id, label })),
        }))

export const decisionOf = (view: DecisionSource): DecisionModel | null => {
  const { card, decision } = view
  if (card === null || decision === null) return null
  return {
    key: `${view.recordId}:${decision.ask}:${card.seq}`,
    recordId: view.recordId,
    number: view.number,
    ask: decision.ask,
    seq: card.seq,
    headline: headlineOf(card, view.number),
    reason: reasonOf(card, view),
    options: optionsOf(card, decision),
    criteria: criteriaOf(view, decision),
    answers: answersOf(view, card),
  }
}
