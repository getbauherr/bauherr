import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next, type Config, type Step } from '../../src/core/lifecycle'
import { briefed, CONFIG, ev, inBuild, inVerify, start } from './fixtures'

type Case = { name: string; events: AppEvent[]; expected: Step; config?: Partial<Config> }

const changed = [start('verify', 'r2'), ev('verify.changes')]
const secondBuild = [start('build', 'r3'), ev('build.submitted', { runId: 'r3' })]
const atVerifyCap = [...inVerify, ...changed, ...secondBuild, ...changed]
const overridden = [
  ...atVerifyCap,
  ev('question.asked'),
  ev('question.answered', { option: 'accept-anyway' }),
  ev('verify.overridden', { patchId: 'p1', headSha: 'h1' }),
]

const CASES: Case[] = [
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

const open = [{ number: 2, state: 'open' as const }]
const OUTSIDE_BUILD: Case[] = [
  {
    name: 'a disputed Intake still asks the owner while a blocker is open',
    events: [start('intake'), ev('intake.disputed')],
    expected: { kind: 'card', card: 'question', reason: 'disputed', options: ['not-a-bug', 'accept', 'ask-again'] },
  },
]

describe('next with an open blocker outside Build', () => {
  it.each(OUTSIDE_BUILD.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const config = { ...CONFIG, ...c.config }
    const state = fold(c.events)
    expect(next(briefed(), state, config, open)).toEqual(c.expected)
  })
})

describe('next after owner decisions', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const config = { ...CONFIG, ...c.config }
    const state = fold(c.events)
    expect(next(briefed(), state, config)).toEqual(c.expected)
  })
})
