import { describe, expect, it } from 'vitest'
import { parseEvent, type EventType } from '../../src/core/events'
import { summarize } from '../../src/core/views/insights'
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
const NOW = at(10_000)
const BY_RULE = [
  ev(0, 'intake.accepted'),
  ev(10, 'brief.submitted', { runId: '1' }),
  ev(12, 'brief.approved', { by: 'rule' }),
]
const patch = { patchId: 'p1', headSha: 'abc', pr: 5 }

const happy = () =>
  timeOf({
    createdAt: at(0),
    now: NOW,
    events: [
      ev(6, 'intake.accepted'),
      ev(20, 'brief.submitted', { runId: '2' }),
      ev(50, 'brief.approved', { by: 'owner' }),
      ev(115, 'build.submitted', { runId: '3', ...patch }),
      ev(126, 'review.submitted', { runId: '4', patchId: 'p1', headSha: 'abc', findings: 0 }),
      ev(136, 'checks.finished', { patchId: 'p1', passed: true }),
      ev(147, 'verify.passed', { runId: '5', patchId: 'p1', headSha: 'abc' }),
      ev(148, 'ship.merged', { sha: 'm1' }),
      ev(200, 'result.accepted'),
    ],
    runs: [
      run(0, 2, 6),
      run(6, 8, 20),
      run(50, 55, 115),
      run(115, 116, 126),
      run(136, 137, 147),
    ],
  })

const stay = (time: ReturnType<typeof happy>, stage: string) => time.stays.find((s) => s.stage === stage)

describe('the time split of one ticket', () => {
  it('measures issue to done from the record to the accepted result', () => {
    const time = happy()
    expect(time.doneAt).toEqual(at(200))
    expect(time.seconds).toBe(200 * 60)
  })

  it('splits each stage into agent working, waiting on you, waiting on CI and queued', () => {
    const time = happy()
    const minutes = (stage: string) => {
      const s = stay(time, stage)
      return s && { total: s.seconds / 60, ...Object.fromEntries(Object.entries(s.split).map(([k, v]) => [k, v / 60])) }
    }
    expect(minutes('intake')).toEqual({ total: 6, agent: 4, you: 0, ci: 0, queued: 2 })
    expect(minutes('brief')).toEqual({ total: 44, agent: 12, you: 30, ci: 0, queued: 2 })
    expect(minutes('build')).toEqual({ total: 65, agent: 60, you: 0, ci: 0, queued: 5 })
    expect(minutes('verify')).toEqual({ total: 32, agent: 20, you: 0, ci: 10, queued: 2 })
    expect(minutes('ship')).toEqual({ total: 53, agent: 0, you: 52, ci: 0, queued: 0 })
    expect(time.you / 60).toBe(82)
  })

  it('counts the whole stay but no part when a brief the rule approves is not waiting on the owner', () => {
    const time = timeOf({
      createdAt: at(0),
      now: NOW,
      events: BY_RULE,
      runs: [run(0, 1, 10)],
    })
    const brief = time.stays.find((s) => s.stage === 'brief')
    expect(brief?.seconds).toBe(12 * 60)
    expect(brief?.split).toEqual({ agent: 9 * 60, you: 0, ci: 0, queued: 60 })
  })

  it('leaves an unclassified wait out of the four parts, so the parts need not add up', () => {
    const time = timeOf({
      createdAt: at(0),
      now: NOW,
      events: BY_RULE,
      runs: [],
    })
    expect(time.stays[0]?.split).toEqual({ agent: 0, you: 0, ci: 0, queued: 0 })
  })

  it('counts a stage entered twice as two stays and counts rounds, send-backs and changed briefs', () => {
    const time = timeOf({
      createdAt: at(0),
      now: NOW,
      events: [
        ev(0, 'intake.accepted'),
        ev(0, 'brief.approved', { by: 'rule' }),
        ev(10, 'build.submitted', { runId: '1', ...patch }),
        ev(20, 'verify.changes', { runId: '2', patchId: 'p1' }),
        ev(30, 'build.submitted', { runId: '3', patchId: 'p2', headSha: 'def', pr: 5 }),
        ev(40, 'verify.passed', { runId: '4', patchId: 'p2', headSha: 'def' }),
        ev(41, 'ship.merged', { sha: 'm' }),
        ev(50, 'result.accepted'),
        ev(60, 'result.sent-back', { note: 'again' }),
        ev(70, 'brief.changes-requested', { note: 'n' }),
      ],
      runs: [],
    })
    expect(time.stays.map((s) => s.stage)).toEqual(['build', 'verify', 'build', 'verify', 'ship', 'build', 'brief'])
    expect(time.verifyRounds).toBe(1)
    expect(time.sentBack).toBe(1)
    expect(time.briefsChanged).toBe(1)
    expect(time.doneAt).toBeNull()
  })

  it('ends an archived ticket as closed, not done', () => {
    const archived = timeOf({
      createdAt: at(0),
      now: NOW,
      events: [ev(0, 'intake.accepted'), ev(15, 'ticket.closed', { reason: 'archived' })],
      runs: [],
    })
    expect(archived.closed).toBe(true)
    expect(archived.doneAt).toBeNull()
    expect(archived.seconds).toBe(15 * 60)
  })

  it('measures an open ticket up to now and puts a live queued run into queued', () => {
    const time = timeOf({
      createdAt: at(0),
      now: at(30),
      events: [ev(0, 'intake.accepted')],
      runs: [run(10, null, null), run(0, 1, 10)],
    })
    expect(time.seconds).toBe(30 * 60)
    expect(time.stays[0]?.split).toMatchObject({ agent: 9 * 60, queued: 60 + 20 * 60 })
  })
})

describe('the summary of done tickets', () => {
  type Extra = { verifyRounds?: number; sentBack?: number }
  const ticket = (minutes: number, brief: [number, number], extra: Extra = {}) => ({
    createdAt: at(0),
    doneAt: at(minutes),
    closed: false,
    seconds: minutes * 60,
    stays: [
      { stage: 'brief' as const, seconds: brief[0] * 60, split: { agent: 0, you: brief[1] * 60, ci: 0, queued: 0 } },
    ],
    you: brief[1] * 60,
    verifyRounds: extra.verifyRounds ?? 0,
    sentBack: extra.sentBack ?? 0,
    briefsChanged: 0,
  })

  it('takes medians of an odd and an even count and shares of rounds and send-backs', () => {
    const odd = summarize([
      ticket(60, [10, 5], { verifyRounds: 2 }),
      ticket(30, [20, 10]),
      ticket(120, [30, 30], { sentBack: 1 }),
    ])
    expect(odd.done).toBe(3)
    expect(odd.medianSeconds).toBe(60 * 60)
    expect(odd.verifyRoundsPerTicket).toBeCloseTo(2 / 3)
    expect(odd.sentBackShare).toBeCloseTo(1 / 3)
    const even = summarize([ticket(30, [10, 0]), ticket(60, [30, 0])])
    expect(even.medianSeconds).toBe(45 * 60)
    expect(even.stages[0]?.seconds).toBe(20 * 60)
  })

  it('scales the split of a stage to its median and names the largest waiting share', () => {
    const summary = summarize([ticket(60, [10, 5]), ticket(30, [20, 10]), ticket(120, [30, 30])])
    const brief = summary.stages[0]
    expect(brief?.seconds).toBe(20 * 60)
    expect(brief?.split.you).toBeCloseTo((20 * 60 * 45) / 60)
    expect(summary.sentence).toBe('Waiting on you is the largest share in Brief.')
  })

  it('has no sentence and no medians without tickets', () => {
    const empty = summarize([])
    expect(empty).toMatchObject({ done: 0, medianSeconds: null, sentBackShare: null, sentence: null, stages: [] })
  })
})
