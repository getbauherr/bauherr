import type { AppEvent } from './events'

export type DecisionInput = { note: string; patchId: string; headSha: string; question: string }
export type AgentCard = { options: string[]; text?: string }
export type DecisionEntry = {
  needsNote: boolean
  keepsNote?: boolean
  endsRun?: boolean
  events: (input: DecisionInput) => AppEvent[]
}

const answered = (option: string): AppEvent => ({ type: 'question.answered', data: { option } })
const closed = (reason: 'not-planned' | 'not-a-bug'): AppEvent => ({ type: 'intake.closed', data: { reason } })
const accepted: AppEvent = { type: 'intake.accepted', data: {} }
const discarded: AppEvent = { type: 'ticket.closed', data: { reason: 'discarded' } }

const one = (...events: AppEvent[]): DecisionEntry => ({ needsNote: false, events: () => events })
const answer = (option: string, ...rest: AppEvent[]): DecisionEntry => one(answered(option), ...rest)
const withNote = (make: (note: string) => AppEvent[]): DecisionEntry => ({
  needsNote: true,
  events: ({ note }) => make(note),
})

export const BACK_TO_BRIEF = 'back-to-brief'
export const WORKING_ASK = 'working'
export const AGENT_ASK = 'question:agent'
export const OWN_ANSWER = 'own-answer'

const backToBrief = (open: boolean): DecisionEntry => ({
  needsNote: true,
  endsRun: true,
  events: ({ note }) => [
    ...(open ? [answered(BACK_TO_BRIEF)] : []),
    { type: 'brief.changes-requested', data: { note } },
  ],
})

const ownAnswer: DecisionEntry = {
  needsNote: true,
  events: ({ note, question }) => [answered(OWN_ANSWER), agentNote(question, note, '')],
}

export const DECISIONS: Record<string, Record<string, DecisionEntry>> = {
  brief: {
    approve: one({ type: 'brief.approved', data: { by: 'owner' } }),
    'request-changes': withNote((note) => [{ type: 'brief.changes-requested', data: { note } }]),
    discard: one({ type: 'brief.discarded', data: {} }),
  },
  result: {
    accept: one({ type: 'result.accepted', data: {} }),
    'send-back': withNote((note) => [{ type: 'result.sent-back', data: { note } }]),
  },
  'question:failed-runs': {
    retry: answer('retry'),
    'retry-with-guidance': withNote((note) => [
      answered('retry-with-guidance'),
      { type: 'owner.note', data: { note } },
    ]),
    discard: answer('discard', discarded),
  },
  'question:parked': {
    resume: answer('resume'),
    discard: answer('discard', discarded),
  },
  'question:reporter-silent': {
    close: answer('close', closed('not-planned')),
    'ask-again': answer('ask-again'),
    accept: answer('accept', accepted),
  },
  'question:disputed': {
    'not-a-bug': answer('not-a-bug', closed('not-a-bug')),
    accept: answer('accept', accepted),
    'ask-again': answer('ask-again'),
  },
  'question:verify-rounds': {
    'one-more-round': answer('one-more-round'),
    'accept-as-is': {
      needsNote: false,
      events: ({ patchId, headSha }) => [
        answered('accept-as-is'),
        { type: 'verify.overridden', data: { patchId, headSha } },
      ],
    },
    discard: answer('discard', discarded),
  },
  'question:already-done': {
    'close-as-done': answer('close-as-done', { type: 'ticket.done-elsewhere', data: {} }),
    're-run-build': answer('re-run-build'),
  },
  'question:deploy-stalled': {
    'check-again': answer('check-again'),
    continue: answer('continue', { type: 'ship.deployed', data: {} }),
  },
  'question:production': {
    approve: answer('approve', { type: 'production.approved', data: {} }),
    hold: answer('hold', { type: 'production.held', data: {} }),
  },
  'production-held': {
    'approve-production': one({ type: 'production.approved', data: {} }),
  },
  [AGENT_ASK]: { [BACK_TO_BRIEF]: backToBrief(true), [OWN_ANSWER]: ownAnswer },
  [WORKING_ASK]: { [BACK_TO_BRIEF]: backToBrief(false) },
}

export const QUESTION_REASONS = [
  'failed-runs',
  'reporter-silent',
  'disputed',
  'verify-rounds',
  'already-done',
  'deploy-stalled',
  'production',
  'agent',
  'parked',
] as const

export type QuestionReason = (typeof QUESTION_REASONS)[number]

export const REMEMBERED: Record<QuestionReason, boolean> = {
  'failed-runs': false,
  'reporter-silent': false,
  disputed: true,
  'verify-rounds': false,
  'already-done': false,
  'deploy-stalled': false,
  production: false,
  agent: true,
  parked: false,
}

export const isRemembered = (reason: string): boolean => REMEMBERED[reason as QuestionReason] === true

export const agentNote = (question: string, answer: string, comment: string): AppEvent => ({
  type: 'owner.note',
  data: { note: [`Question: ${question}`, `Answer: ${answer}`, comment].filter((l) => l !== '').join('\n') },
})

export const agentEntry = (card: AgentCard | null, choice: string): DecisionEntry | undefined =>
  card?.options.includes(choice)
    ? {
        needsNote: false,
        keepsNote: true,
        events: ({ note }) => [answered(choice), agentNote(card.text ?? '', choice, note)],
      }
    : undefined

export const withComment = (entry: DecisionEntry, events: AppEvent[], note: string): AppEvent[] => {
  if (entry.needsNote || entry.keepsNote === true || note === '') return events
  return [...events.slice(0, 1), { type: 'owner.note', data: { note } }, ...events.slice(1)]
}
