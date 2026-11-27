import { OWN_ANSWER } from '../../../core/decisions'
import type { StoredCard } from '../../../core/record/store'
import type { TicketView } from '../../../core/views/ticket'
import {
  ACCEPT_ANYWAY,
  DROP_CRITERIA,
  EXTRA_CHOICE_WORDS,
  GHOST_CHOICES,
  HEADLINES,
  OPTIONAL_NOTE,
  PREFERRED_CHOICES,
  PRIMARY_CHOICE,
  RESULT_REASON,
} from './inbox-words'
import { recommendedOption } from './question-facts'
import { CHOICE_WORDS, NOTE_PROMPTS, NOTE_SAYS, REASON_WORDS } from './ticket-words'

export type DecisionSource = Pick<TicketView, 'recordId' | 'number' | 'card' | 'record' | 'deploy'>

export type Tier = 'primary' | 'secondary' | 'ghost'
export type NoteSpec = { prompt: string; say: string; required: boolean }
export type DecisionOption = { choice: string; label: string; tier: Tier; note: NoteSpec | null; criteria: boolean }
export type CriterionRow = { id: string; text: string }
export type CriteriaModel = { active: CriterionRow[]; dropped: string[]; suggested: string[] }
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

const reasonOf = (card: StoredCard): string => {
  if (card.card === 'result') return RESULT_REASON
  if (card.reason === 'agent') return card.text ?? REASON_WORDS.agent
  if (card.reason === 'parked') return `${REASON_WORDS.parked}: ${card.text ?? ''}`
  return REASON_WORDS[card.reason as keyof typeof REASON_WORDS] ?? card.reason
}

const headlineOf = (card: StoredCard, number: number): string => {
  if (card.reason === 'agent') return card.text ?? 'The agent has a question'
  const key = card.card === 'question' ? card.reason : card.card
  return (HEADLINES[key] ?? 'What should the factory do on #{n}?').replace('{n}', String(number))
}

const choicesOf = (card: StoredCard): string[] => {
  if (card.card === 'brief') return ['approve', 'request-changes', 'discard']
  if (card.card === 'result') return ['accept', 'send-back']
  return card.reason === 'agent' ? [...card.options, OWN_ANSWER] : card.options
}

const primaryOf = (card: StoredCard, choices: string[], view: DecisionSource): string => {
  const ask = askOf(card)
  const key = card.card === 'question' ? card.reason : card.card
  const wanted = [
    ...PREFERRED_CHOICES,
    recommendedOption(view, card.reason),
    PRIMARY_CHOICE[key],
    choices.find((choice) => choice !== OWN_ANSWER),
  ]
  return wanted.find((choice) => choice != null && choices.includes(choice)) ?? choices[0] ?? ask
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

const optionsOf = (card: StoredCard, view: DecisionSource): DecisionOption[] => {
  const ask = askOf(card)
  const choices = choicesOf(card)
  const primary = primaryOf(card, choices, view)
  const order = ['primary', 'secondary', 'ghost']
  return choices
    .map((choice): DecisionOption => ({
      choice,
      label: CHOICE_WORDS[ask]?.[choice] ?? EXTRA_CHOICE_WORDS[choice] ?? choice,
      tier: tierOf(choice, primary),
      note: noteOf(ask, choice),
      criteria: choice === DROP_CRITERIA,
    }))
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
}

const UNMET = ['open', 'missing', 'partial']

export const criteriaOf = (view: DecisionSource, choices: string[]): CriteriaModel | null => {
  if (!choices.includes(DROP_CRITERIA) && !choices.includes(ACCEPT_ANYWAY)) return null
  const rows = view.record.criteria
  const active = rows.filter((row) => row.status !== 'waived')
  return {
    active: active.map(({ id, text }) => ({ id, text })),
    dropped: rows.filter((row) => row.status === 'waived').map((row) => row.id),
    suggested: active.filter((row) => UNMET.includes(row.status)).map((row) => row.id),
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
  const { card } = view
  if (card === null) return null
  const options = optionsOf(card, view)
  return {
    key: `${view.recordId}:${askOf(card)}:${card.seq}`,
    recordId: view.recordId,
    number: view.number,
    ask: askOf(card),
    seq: card.seq,
    headline: headlineOf(card, view.number),
    reason: reasonOf(card),
    options,
    criteria: criteriaOf(view, options.map((option) => option.choice)),
    answers: answersOf(view, card),
  }
}
