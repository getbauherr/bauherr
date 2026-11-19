import { describe, expect, it } from 'vitest'
import { parseEvent, type AppEvent } from '../../src/core/events'
import { fold, next, type Step } from '../../src/core/lifecycle'
import { briefed, CONFIG, ev, SAMPLES, start } from './fixtures'

const approvedByRule = ev('brief.approved', { by: 'rule' })

const HAPPY_PATH: [AppEvent | null, Step][] = [
  [null, { kind: 'run', stage: 'intake', role: 'builder' }],
  [ev('intake.accepted'), { kind: 'run', stage: 'brief', role: 'builder' }],
  [start('brief'), { kind: 'wait', on: 'run' }],
  [ev('brief.submitted'), { kind: 'emit', event: approvedByRule }],
  [approvedByRule, { kind: 'run', stage: 'build', role: 'builder' }],
  [start('build'), { kind: 'wait', on: 'run' }],
  [ev('build.submitted'), { kind: 'wait', on: 'checks' }],
  [ev('checks.finished'), { kind: 'run', stage: 'verify', role: 'verifier' }],
  [start('verify', 'r2'), { kind: 'wait', on: 'run' }],
  [ev('verify.passed'), { kind: 'effect', effect: 'merge' }],
  [ev('ship.merged'), { kind: 'card', card: 'result', reason: 'result', options: [] }],
  [ev('result.accepted'), { kind: 'done' }],
]

describe('replay', () => {
  it('folds a full happy path one event at a time into the written-out steps', () => {
    const events: AppEvent[] = []
    const steps = HAPPY_PATH.map(([event]) => {
      if (event) events.push(event)
      return next(briefed(), fold(events), CONFIG)
    })
    expect(steps).toEqual(HAPPY_PATH.map(([, step]) => step))
  })

  it('gives the same steps when the production gate is on, up to the production question', () => {
    const events = HAPPY_PATH.flatMap(([event]) => (event ? [event] : []))
    const config = { ...CONFIG, productionGate: true }
    const state = fold(events, { productionGate: true })
    expect(next(briefed(), state, config)).toEqual({
      kind: 'card',
      card: 'question',
      reason: 'production',
      options: ['approve', 'hold'],
    })
  })
})

const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}

const POOL: AppEvent[] = Object.entries(SAMPLES).map(([type, data]) => parseEvent({ type, data }))

describe('fold and next', () => {
  it('are deterministic, pure and never throw on any ordering of valid events', () => {
    const random = seeded(20261119)
    for (let i = 0; i < 400; i++) {
      const pick = () => POOL[Math.floor(random() * POOL.length)]
      const events = Array.from({ length: Math.floor(random() * 30) }, pick).flatMap((e) => (e ? [e] : []))
      const before = structuredClone(events)
      for (const productionGate of [false, true]) {
        const config = { ...CONFIG, productionGate, deployChecks: productionGate }
        const first = fold(events, { productionGate })
        expect(fold(events, { productionGate })).toEqual(first)
        const step = next(briefed(), first, config)
        expect(next(briefed(), first, config)).toEqual(step)
        expect(step.kind).toMatch(/^(run|card|emit|effect|wait|done)$/)
      }
      expect(events).toEqual(before)
    }
  })
})
