import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import type { StoredEvent } from '../../src/core/record/store'
import { activityOf } from '../../src/core/views/activity'

let counter = 0
const stored = (event: AppEvent): StoredEvent => ({
  ...event,
  id: ++counter,
  recordId: 1,
  actor: 'owner',
  actorId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
})
const labels = (events: AppEvent[]) => activityOf(events.map(stored)).map((e) => e.label)

describe('the Activity words of a choice with a comment', () => {
  it('shows an agent option and its comment on one line', () => {
    expect(
      labels([
        { type: 'question.answered', data: { option: 'a' } },
        { type: 'owner.note', data: { note: 'Question: Which?\nAnswer: a\nkeep it small' } },
      ]),
    ).toEqual(['The owner answered: a. Comment: keep it small'])
  })

  it('shows an agent option without a comment as the answer alone', () => {
    expect(
      labels([
        { type: 'question.answered', data: { option: 'a' } },
        { type: 'owner.note', data: { note: 'Question: Which?\nAnswer: a' } },
      ]),
    ).toEqual(['The owner answered: a'])
  })

  it('shows the free answer in the owner words', () => {
    expect(
      labels([
        { type: 'question.answered', data: { option: 'own-answer' } },
        { type: 'owner.note', data: { note: 'Question: Which?\nAnswer: use a queue\nnot a cron' } },
      ]),
    ).toEqual(['The owner answered in their own words: use a queue\nnot a cron'])
  })

  it('puts the comment of any other choice behind the choice', () => {
    expect(
      labels([
        { type: 'brief.approved', data: { by: 'owner' } },
        { type: 'owner.note', data: { note: 'Mind the migration.' } },
      ]),
    ).toEqual(['The owner approved the Brief. Comment: Mind the migration.'])
    expect(
      labels([
        { type: 'question.answered', data: { option: 'discard' } },
        { type: 'owner.note', data: { note: 'No longer needed' } },
        { type: 'ticket.closed', data: { reason: 'discarded' } },
      ]),
    ).toEqual(['The owner answered: discard. Comment: No longer needed', 'The owner discarded the ticket'])
  })

  it('reads a change request after an approval as a send-back to Brief, and before one as a change request', () => {
    expect(
      labels([
        { type: 'brief.submitted', data: { runId: '1' } },
        { type: 'brief.changes-requested', data: { note: 'shorter' } },
        { type: 'brief.submitted', data: { runId: '2' } },
        { type: 'brief.approved', data: { by: 'owner' } },
        { type: 'brief.changes-requested', data: { note: 'redo it' } },
      ]),
    ).toEqual([
      'A Brief was submitted',
      'The owner asked for changes to the Brief: shorter',
      'A Brief was submitted',
      'The owner approved the Brief',
      'Sent back to Brief: redo it',
    ])
  })
})
