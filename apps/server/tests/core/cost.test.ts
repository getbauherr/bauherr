import { describe, expect, it } from 'vitest'
import { attribute, outsideRuns, type CostRun, type GatewayRequest } from '../../src/core/cost'

const BASE = Date.parse('2026-11-20T10:00:00Z')
const at = (minutes: number): Date => new Date(BASE + minutes * 60_000)
const session = (id: number, name: string, from: number, to: number): CostRun => ({
  id,
  link: { kind: 'session', session: name },
  claimedAt: at(from),
  endedAt: at(to),
})
const request = (minutes: number, cost: number | null, extra: Partial<GatewayRequest> = {}): GatewayRequest => ({
  at: at(minutes),
  cost,
  inputTokens: 100,
  outputTokens: 20,
  session: 's1',
  run: null,
  ...extra,
})

describe('attributing gateway requests to runs', () => {
  it('sums the requests of the session between claim and end for one run', () => {
    const measured = attribute(
      [session(1, 's1', 0, 10)],
      [request(1, 0.5), request(9, 0.25), request(10, 4), request(-1, 4), request(5, 8, { session: 's2' })],
    )
    expect(measured.get(1)).toEqual({ costUsd: 0.75, inputTokens: 200, outputTokens: 40 })
  })

  it('splits a request evenly over the runs the session held at that moment', () => {
    const runs = [session(1, 's1', 0, 20), session(2, 's1', 10, 30)]
    const measured = attribute(runs, [request(5, 1), request(15, 1), request(25, 1)])
    expect(measured.get(1)).toEqual({ costUsd: 1.5, inputTokens: 150, outputTokens: 30 })
    expect(measured.get(2)).toEqual({ costUsd: 1.5, inputTokens: 150, outputTokens: 30 })
  })

  it('counts the tokens of an unpriced request but leaves the cost of that run unmeasured', () => {
    const measured = attribute([session(1, 's1', 0, 10), session(2, 's2', 0, 10)], [
      request(1, 0.5),
      request(2, null),
      request(3, 0.5, { session: 's2' }),
    ])
    expect(measured.get(1)).toEqual({ costUsd: null, inputTokens: 200, outputTokens: 40 })
    expect(measured.get(2)?.costUsd).toBe(0.5)
  })

  it('gives a run without requests no entry, so it stays unmeasured and never becomes zero', () => {
    expect(attribute([session(1, 's1', 0, 10)], [request(50, 1)]).has(1)).toBe(false)
  })

  it('matches a Runner request by the run it names, not by time', () => {
    const runner: CostRun = { id: 7, link: { kind: 'run' }, claimedAt: at(0), endedAt: at(10) }
    const measured = attribute([runner, session(1, 's1', 0, 10)], [
      request(99, 0.4, { session: null, run: '7' }),
      request(99, 0.1, { session: null, run: '8' }),
    ])
    expect(measured.get(7)).toEqual({ costUsd: 0.4, inputTokens: 100, outputTokens: 20 })
    expect(measured.has(1)).toBe(false)
  })
})

describe('cost outside runs', () => {
  it('sums by day what falls in no run of its session and skips Runner and unpriced requests', () => {
    const days = outsideRuns(
      [session(1, 's1', 0, 10)],
      [
        request(5, 1),
        request(20, 0.5),
        request(30, 0.25),
        request(40, null),
        request(50, 2, { session: null, run: '1' }),
        request(24 * 60 + 5, 0.125),
      ],
    )
    expect(Object.fromEntries(days)).toEqual({ '2026-11-20': 0.75, '2026-11-21': 0.125 })
  })
})
