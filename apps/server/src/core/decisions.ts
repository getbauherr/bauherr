import type { AppEvent } from './events'

export type DecisionInput = { note: string; patchId: string; headSha: string }
export type DecisionEntry = { needsNote: boolean; events: (input: DecisionInput) => AppEvent[] }

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
  'question:production': {
    approve: answer('approve', { type: 'production.approved', data: {} }),
    hold: answer('hold', { type: 'production.held', data: {} }),
  },
  'production-held': {
    'approve-production': one({ type: 'production.approved', data: {} }),
  },
}
