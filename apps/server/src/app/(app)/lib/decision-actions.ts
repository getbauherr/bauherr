import type { DecisionAction } from '../components/ticket/DecisionForm'
import { CHOICE_WORDS, NOTE_PROMPTS, NOTE_SAYS } from './ticket-words'

type Choice = { choice: string; variant: DecisionAction['variant'] }

const actionsOf = (ask: string, choices: Choice[]): DecisionAction[] =>
  choices.map(({ choice, variant }) => {
    const prompt = NOTE_PROMPTS[`${ask}/${choice}`]
    const say = NOTE_SAYS[`${ask}/${choice}`]
    const label = CHOICE_WORDS[ask]?.[choice] ?? choice
    return { choice, variant, label, ...(prompt ? { prompt } : {}), ...(say ? { say } : {}) }
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

export const BACK_ACTION: DecisionAction = {
  choice: 'back-to-brief',
  variant: 'outline',
  label: 'Back to Brief',
  prompt: NOTE_PROMPTS['working/back-to-brief'] ?? '',
  say: NOTE_SAYS['working/back-to-brief'] ?? '',
  fixed: true,
}
