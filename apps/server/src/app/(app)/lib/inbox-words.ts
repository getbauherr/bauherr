export const HEADLINES: Record<string, string> = {
  brief: 'Approve the Brief for #{n}?',
  result: 'Accept the result of #{n}?',
  'failed-runs': 'Try #{n} again?',
  'brief-failed': 'Write the Brief for #{n} again?',
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
  'brief-failed': 'retry-brief',
  'reporter-silent': 'ask-again',
  disputed: 'accept',
  'already-done': 'close-as-done',
  'deploy-stalled': 'check-again',
  parked: 'resume',
}

export const GHOST_CHOICES = ['discard', 'close', 'not-a-bug']

export const OPTIONAL_NOTE = 'The agent keeps this as a memory.'

export const SUGGESTIONS = [
  { title: 'Why this recommendation?', prompt: 'Why do you recommend this?' },
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
  'accept-anyway': 'Accepted anyway',
  'drop-criteria': 'Criteria dropped',
  'retry-brief': 'Writing the Brief again',
}
