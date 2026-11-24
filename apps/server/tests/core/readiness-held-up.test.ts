import { describe, expect, it } from 'vitest'
import { parseEvent, type EventType } from '../../src/core/events'
import { heldUp } from '../../src/core/readiness/held-up'
import { timeOf, type TimedEvent, type TimedRun } from '../../src/core/views/time-split'

const BASE = Date.parse('2026-11-01T00:00:00Z')
const at = (minutes: number): Date => new Date(BASE + minutes * 60_000)
const ev = (minutes: number, type: EventType, data: unknown = {}): TimedEvent => ({
  event: parseEvent({ type, data }),
  at: at(minutes),
})
const run = (created: number, started: number | null, finished: number | null): TimedRun => ({
  createdAt: at(created),
  startedAt: started === null ? null : at(started),
  finishedAt: finished === null ? null : at(finished),
})
const patch = { patchId: 'p1', headSha: 'abc', pr: 5 }

const ticketTime = (checksMinutes: number, queuedMinutes: number) =>
  timeOf({
    createdAt: at(0),
    now: at(10_000),
    events: [
      ev(1, 'intake.accepted'),
      ev(5, 'brief.submitted', { runId: '1' }),
      ev(6, 'brief.approved', { by: 'rule' }),
      ev(60, 'build.submitted', { runId: '2', ...patch }),
      ev(70, 'review.submitted', { runId: '3', patchId: 'p1', headSha: 'abc', findings: 0 }),
      ev(70 + checksMinutes, 'checks.finished', { patchId: 'p1', passed: true }),
      ev(80 + checksMinutes, 'verify.passed', { runId: '4', patchId: 'p1', headSha: 'abc' }),
      ev(81 + checksMinutes, 'ship.merged', { sha: 'm1' }),
      ev(90 + checksMinutes, 'result.accepted'),
    ],
    runs: [
      run(1, 1, 5),
      run(6, 6 + queuedMinutes, 60),
      run(60, 60, 70),
      run(70 + checksMinutes, 70 + checksMinutes, 80 + checksMinutes),
    ],
  })

describe('what was held up, from the same time split as Insights', () => {
  it('counts a wait on checks of more than an hour and the time queued with no agent', () => {
    const found = heldUp([ticketTime(180, 0), ticketTime(20, 30), ticketTime(10, 0)])
    expect(found.checks).toEqual({ tickets: 1, seconds: 180 * 60 })
    expect(found.queued).toEqual({ tickets: 1, seconds: 30 * 60 })
    expect(found.tickets).toBe(2)
    expect(found.seconds).toBe((180 + 30) * 60)
  })

  it('is empty without tickets', () => {
    expect(heldUp([])).toEqual({
      tickets: 0,
      seconds: 0,
      checks: { tickets: 0, seconds: 0 },
      queued: { tickets: 0, seconds: 0 },
    })
  })
})
