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
const marksOf = (...events: AppEvent[]) =>
  activityOf(events.map(stored)).map(({ kind, tone, state, enters }) => ({ kind, tone, state, enters }))

const auto = {
  door: 'two-way',
  criteriaMet: 3,
  criteriaTotal: 3,
  checks: 'passed',
  sendBackPercent: 0,
  maxSendBackPercent: 20,
} as const

describe('the Timeline marks of a ticket', () => {
  it('shows a run with its state', () => {
    expect(
      marksOf(
        { type: 'run.started', data: { stage: 'build', runId: 'r1', fingerprint: 'f' } },
        { type: 'run.failed', data: { stage: 'build', runId: 'r1', reason: 'timeout' } },
      ),
    ).toEqual([
      { kind: 'run', tone: 'neutral', state: 'Queued', enters: null },
      { kind: 'run', tone: 'error', state: 'Failed', enters: null },
    ])
  })

  it('tells the owner decision from the factory decision on the same event', () => {
    expect(
      marksOf(
        { type: 'brief.approved', data: { by: 'owner' } },
        { type: 'brief.approved', data: { by: 'rule' } },
        { type: 'result.accepted', data: {} },
        { type: 'result.accepted', data: { auto } },
      ),
    ).toEqual([
      { kind: 'owner', tone: 'ok', state: 'Approved', enters: 'build' },
      { kind: 'factory', tone: 'ok', state: 'By rule', enters: 'build' },
      { kind: 'owner', tone: 'ok', state: 'Accepted', enters: 'done' },
      { kind: 'factory', tone: 'ok', state: 'Accepted by the factory', enters: 'done' },
    ])
  })

  it('marks dropped criteria and the stage a send-back returns to', () => {
    expect(
      marksOf(
        { type: 'criteria.dropped', data: { criteria: ['It is fast'], note: '' } },
        { type: 'verify.changes', data: { runId: 'r1', patchId: 'p1' } },
      ),
    ).toEqual([
      { kind: 'criteria', tone: 'warn', state: 'Dropped', enters: null },
      { kind: 'run', tone: 'warn', state: 'Changes asked', enters: 'build' },
    ])
  })
})
