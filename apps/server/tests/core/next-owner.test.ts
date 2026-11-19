import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next, type Config, type Step } from '../../src/core/lifecycle'
import { briefed, CONFIG, ev, inBuild, inVerify, merged, start } from './fixtures'

type Case = { name: string; events: AppEvent[]; expected: Step; config?: Partial<Config> }

const wait = (on: 'owner'): Step => ({ kind: 'wait', on })
const resultCard: Step = { kind: 'card', card: 'result', reason: 'result', options: [] }
const gated = { productionGate: true }
const changed = [start('verify', 'r2'), ev('verify.changes')]
const secondBuild = [start('build', 'r3'), ev('build.submitted', { runId: 'r3' })]
const atVerifyCap = [...inVerify, ...changed, ...secondBuild, ...changed]
const overridden = [
  ...atVerifyCap,
  ev('question.asked'),
  ev('question.answered', { option: 'accept-as-is' }),
  ev('verify.overridden', { patchId: 'p1', headSha: 'h1' }),
]

const CASES: Case[] = [
  {
    name: 'a held production waits on the owner instead of asking again',
    events: [...merged, ev('result.accepted'), ev('question.asked'), ev('question.answered'), ev('production.held')],
    config: gated,
    expected: wait('owner'),
  },
  {
    name: 'a held production is done once approved',
    events: [...merged, ev('result.accepted'), ev('production.held'), ev('production.approved')],
    config: gated,
    expected: { kind: 'done' },
  },
  {
    name: 'a held production is not asked about before the result is accepted',
    events: [...merged, ev('production.held')],
    config: gated,
    expected: resultCard,
  },
  {
    name: 'a discarded ticket is done',
    events: [...inBuild, ev('ticket.closed')],
    expected: { kind: 'done' },
  },
  {
    name: 'an override moves a ticket at the verify cap on to the merge',
    events: overridden,
    expected: { kind: 'effect', effect: 'merge' },
  },
  {
    name: 'an owner note makes the next run carry it',
    events: [...inBuild, ev('owner.note')],
    expected: { kind: 'run', stage: 'build', role: 'builder' },
  },
]

describe('next after owner decisions', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const config = { ...CONFIG, ...c.config }
    const state = fold(c.events, { productionGate: config.productionGate })
    expect(next(briefed(), state, config)).toEqual(c.expected)
  })
})
