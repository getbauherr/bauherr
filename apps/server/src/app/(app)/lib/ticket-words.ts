import type { BriefReason } from '../../../core/lifecycle'

export type QuestionReason =
  | 'failed-runs'
  | 'brief-failed'
  | 'reporter-silent'
  | 'disputed'
  | 'verify-rounds'
  | 'already-done'
  | 'deploy-stalled'
  | 'agent'
  | 'parked'

export const REASON_WORDS: Record<BriefReason | QuestionReason, string> = {
  'open-decision': 'This Brief has an open decision.',
  'one-way-door': 'This change cannot be undone.',
  'risk-area': 'This change touches a risk area of the Product.',
  'visible-change': 'A user will see a difference on a screen: check the mockup.',
  backlog: 'This issue existed before the project was connected.',
  'external-request': 'A person outside the team asked for this change.',
  readiness:
    'The owner asked the factory to open this ticket from the readiness check. ' +
    'Check the Brief before the build goes on.',
  'sent-back': 'You sent this ticket back to Brief. Check the new Brief before the build goes on.',
  'failed-runs': 'Runs on this ticket failed several times in a row. What should the factory do?',
  'brief-failed': 'The Brief rewrite failed. The old Brief is not offered again. What should the factory do?',
  'reporter-silent': 'The reporter did not answer the questions the factory asked. What should the factory do?',
  disputed: 'The agent disputes that this issue is a change to make. What should the factory do?',
  'verify-rounds': 'The patch was sent back from review several times. What should the factory do?',
  'already-done': 'The builder found this ticket already done by other work. What should the factory do?',
  'deploy-stalled': 'The change is merged, but it is not confirmed to be on staging yet. What should the factory do?',
  agent: 'The agent has a question.',
  parked: 'Parked',
}

export const CHOICE_WORDS: Record<string, Record<string, string>> = {
  brief: { approve: 'Approve Brief', 'request-changes': 'Request changes', discard: 'Discard' },
  result: { accept: 'Accept', 'send-back': 'Send back with note', 'drop-criteria': 'Drop criteria' },
  'question:brief-failed': { 'retry-brief': 'Retry the Brief', discard: 'Discard' },
  'question:failed-runs': { retry: 'Retry', 'retry-with-guidance': 'Retry with guidance', discard: 'Discard' },
  'question:parked': { resume: 'Resume', discard: 'Discard' },
  'question:reporter-silent': {
    close: 'Close the issue',
    'ask-again': 'Ask the reporter again',
    accept: 'Accept the issue as it is',
  },
  'question:disputed': {
    'not-a-bug': 'Not a bug: close the issue',
    accept: 'Accept as a change to make',
    'ask-again': 'Ask the reporter once more',
  },
  'question:verify-rounds': {
    'one-more-round': 'One more review round',
    'accept-anyway': 'Accept anyway',
    'drop-criteria': 'Drop criteria',
    discard: 'Discard',
  },
  'question:already-done': { 'close-as-done': 'Close as done', 're-run-build': 'Re-run build' },
  'question:deploy-stalled': { 'check-again': 'Check again', continue: 'It is deployed: go on' },
  'question:agent': {
    'back-to-brief': 'Back to Brief',
    'own-answer': 'None of these, my answer:',
    'drop-criteria': 'Drop criteria',
    'accept-anyway': 'Accept anyway',
  },
  working: { 'back-to-brief': 'Back to Brief' },
}

const BACK_PROMPT = 'The agent reads this before it rewrites the Brief. The pull request stays open.'

export const NOTE_PROMPTS: Record<string, string> = {
  'brief/request-changes': 'The agent reads this before it rewrites the Brief.',
  'result/send-back': 'The agent reads this before it starts the next build.',
  'question:agent/back-to-brief': BACK_PROMPT,
  'working/back-to-brief': BACK_PROMPT,
  'question:failed-runs/retry-with-guidance': 'The agent reads this before it tries again.',
  'question:agent/own-answer': 'The agent reads this as your answer.',
}

export const NOTE_SAYS: Record<string, string> = {
  'brief/request-changes': 'Say what should change',
  'result/send-back': 'Say what should change',
  'question:agent/back-to-brief': 'Say what is wrong with the Brief',
  'working/back-to-brief': 'Say what is wrong with the Brief',
  'question:failed-runs/retry-with-guidance': 'Say what the agent should do differently',
  'question:agent/own-answer': 'Write your answer',
}

export const STALE_SENTENCE = 'The ticket moved while this was open. Reload to see where it is now.'
