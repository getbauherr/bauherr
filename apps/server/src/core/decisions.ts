import type { AppEvent } from './events'

export type DecisionInput = {
  note: string
  patchId: string
  headSha: string
  question: string
  criteria: string[]
}
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

export const DROP_CRITERIA = 'drop-criteria'
export const ACCEPT_ANYWAY = 'accept-anyway'
export const RETRY_BRIEF = 'retry-brief'
export const VERIFY_EXITS = [DROP_CRITERIA, ACCEPT_ANYWAY]

export const questionKey = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

export const withVerifyExits = (options: string[], repeated: boolean): string[] =>
  repeated ? [...VERIFY_EXITS, ...options] : [...options, ...VERIFY_EXITS]

export const verifyRoundsOptions = (repeated: boolean): string[] =>
  repeated
    ? [...VERIFY_EXITS, 'one-more-round', 'discard']
    : ['one-more-round', ACCEPT_ANYWAY, DROP_CRITERIA, 'discard']

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

const droppedEvent = ({ criteria, note }: DecisionInput): AppEvent => ({
  type: 'criteria.dropped',
  data: { criteria, note },
})

const dropping = (events: (input: DecisionInput) => AppEvent[]): DecisionEntry => ({
  needsNote: false,
  keepsNote: true,
  events,
})

const acceptAnyway: DecisionEntry = {
  needsNote: false,
  events: ({ patchId, headSha }) => [
    answered(ACCEPT_ANYWAY),
    { type: 'verify.overridden', data: { patchId, headSha } },
  ],
}

const droppedByAgentAsk: DecisionEntry = dropping((input) => [
  answered(DROP_CRITERIA),
  droppedEvent(input),
  agentNote(input.question, `Dropped ${input.criteria.join(', ')}`, input.note),
])

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
    [DROP_CRITERIA]: dropping((input) => [droppedEvent(input)]),
  },
  'question:brief-failed': {
    [RETRY_BRIEF]: answer(RETRY_BRIEF),
    discard: answer('discard', discarded),
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
    [ACCEPT_ANYWAY]: acceptAnyway,
    [DROP_CRITERIA]: dropping((input) => [answered(DROP_CRITERIA), droppedEvent(input)]),
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
  [AGENT_ASK]: {
    [BACK_TO_BRIEF]: backToBrief(true),
    [OWN_ANSWER]: ownAnswer,
    [DROP_CRITERIA]: droppedByAgentAsk,
    [ACCEPT_ANYWAY]: acceptAnyway,
  },
  [WORKING_ASK]: { [BACK_TO_BRIEF]: backToBrief(false) },
}

export const QUESTION_REASONS = [
  'failed-runs',
  'brief-failed',
  'reporter-silent',
  'disputed',
  'verify-rounds',
  'already-done',
  'deploy-stalled',
  'agent',
  'parked',
] as const

export type QuestionReason = (typeof QUESTION_REASONS)[number]

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
