import { describe, expect, it } from 'vitest'
import { parseEvent, type EventType } from '../../src/core/events'
import { SAMPLES } from './fixtures'

const BAD: [EventType, unknown][] = [
  ['intake.asked', { round: 0 }],
  ['intake.asked', {}],
  ['intake.closed', { reason: 'spam' }],
  ['run.started', { stage: 'review', runId: 'r1', fingerprint: 'fp' }],
  ['run.started', { stage: 'build', runId: 'r1' }],
  ['run.failed', { stage: 'build', runId: 'r1' }],
  ['brief.approved', { by: 'factory' }],
  ['build.submitted', { runId: 'r1', patchId: 'p1', pr: 0 }],
  ['checks.finished', { patchId: 'p1', passed: 'yes' }],
  ['ship.merged', {}],
  ['result.sent-back', { note: ' ' }],
  ['question.asked', { reason: 'x', options: ['only'] }],
  ['question.asked', { reason: 'x', options: ['a', 'b', 'c', 'd', 'e'] }],
  ['question.answered', {}],
]

describe('parseEvent', () => {
  it('has a sample for every event type, and parses each', () => {
    expect(Object.keys(SAMPLES)).toHaveLength(24)
    for (const [type, data] of Object.entries(SAMPLES)) {
      expect(parseEvent({ type, data })).toEqual({ type, data })
    }
  })

  it.each(BAD)('rejects bad data for %s', (type, data) => {
    expect(() => parseEvent({ type, data })).toThrow()
  })

  it('accepts 2 and 4 question options', () => {
    const asked = (options: string[]) => parseEvent({ type: 'question.asked', data: { reason: 'x', options } }).type
    expect(asked(['a', 'b'])).toBe('question.asked')
    expect(asked(['a', 'b', 'c', 'd'])).toBe('question.asked')
  })

  it('rejects an unknown type', () => {
    expect(() => parseEvent({ type: 'ship.exploded', data: {} })).toThrow()
  })
})
