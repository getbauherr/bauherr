import type { DecisionAction } from '../components/ticket/DecisionForm'
import { CHOICE_WORDS, NOTE_PROMPTS } from './ticket-words'

type Choice = { choice: string; variant: DecisionAction['variant'] }

const actionsOf = (ask: string, choices: Choice[]): DecisionAction[] =>
  choices.map(({ choice, variant }) => {
    const prompt = NOTE_PROMPTS[`${ask}/${choice}`]
    return { choice, variant, label: CHOICE_WORDS[ask]?.[choice] ?? choice, ...(prompt ? { prompt } : {}) }
  })

export const BRIEF_ACTIONS = actionsOf('brief', [
  { choice: 'discard', variant: 'danger' },
  { choice: 'request-changes', variant: 'outline' },
  { choice: 'approve', variant: 'default' },
])

export const RESULT_ACTIONS = actionsOf('result', [
  { choice: 'send-back', variant: 'outline' },
  { choice: 'accept', variant: 'default' },
])

export const ANSWER_ACTION: DecisionAction = { choice: '', label: 'Answer', variant: 'default' }
