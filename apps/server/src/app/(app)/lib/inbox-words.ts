export const DROP_CRITERIA = 'drop-criteria'
export const ACCEPT_ANYWAY = 'accept-anyway'
export const RETRY_BRIEF = 'retry-brief'

export const EXTRA_CHOICE_WORDS: Record<string, string> = {
  [DROP_CRITERIA]: 'Drop the ticked criteria',
  [ACCEPT_ANYWAY]: 'Accept anyway',
  [RETRY_BRIEF]: 'Write the Brief again',
}

export const HEADLINES: Record<string, string> = {
  brief: 'Approve the Brief for #{n}?',
  result: 'Accept the result of #{n}?',
  'failed-runs': 'Try #{n} again?',
  'verify-rounds': 'How should #{n} go on after the review rounds?',
  'reporter-silent': 'The reporter of #{n} did not answer. What now?',
  disputed: 'Is #{n} a change to make?',
  'already-done': 'Is #{n} already done?',
  'deploy-stalled': 'Is #{n} on staging?',
  parked: 'Resume #{n}?',
}

export const RESULT_REASON = 'Verify is finished. Check the proof per criterion before you accept.'

export const PRIMARY_CHOICE: Record<string, string> = {
  brief: 'approve',
  result: 'accept',
  'failed-runs': 'retry',
  'verify-rounds': 'one-more-round',
  'reporter-silent': 'ask-again',
  disputed: 'accept',
  'already-done': 'close-as-done',
  'deploy-stalled': 'check-again',
  parked: 'resume',
}

export const PREFERRED_CHOICES = [DROP_CRITERIA, RETRY_BRIEF]

export const GHOST_CHOICES = ['discard', 'close', 'not-a-bug']

export const OPTIONAL_NOTE = 'The agent keeps this as a memory.'

export const SUGGESTIONS = [
  { title: 'Why this recommendation?', prompt: 'Why do you recommend this?' },
  { title: 'What changed since the last round?', prompt: 'What changed since the last round?' },
]

export const UNDO_MS = 6000

export const RECEIPTS: Record<string, string> = {
  approve: 'Brief approved',
  'request-changes': 'Changes requested',
  discard: 'Discarded',
  accept: 'Accepted',
  'send-back': 'Sent back',
  retry: 'Retrying',
  'retry-with-guidance': 'Retrying with your guidance',
  'one-more-round': 'One more round granted',
  'accept-as-is': 'Patch accepted as it is',
  [DROP_CRITERIA]: 'Criteria dropped',
  [ACCEPT_ANYWAY]: 'Accepted anyway',
  [RETRY_BRIEF]: 'Writing the Brief again',
}
