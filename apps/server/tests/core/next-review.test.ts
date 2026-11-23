import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next, type Step } from '../../src/core/lifecycle'
import { briefed, CONFIG, ev, inVerify, reviewed, start } from './fixtures'

type Case = { name: string; events: AppEvent[]; expected: Step }

const reviewer: Step = { kind: 'run', stage: 'verify', role: 'reviewer' }
const verifier: Step = { kind: 'run', stage: 'verify', role: 'verifier' }
const waitRun: Step = { kind: 'wait', on: 'run' }
const waitChecks: Step = { kind: 'wait', on: 'checks' }
const merge: Step = { kind: 'effect', effect: 'merge' }
const changed = [start('verify', 'r2'), ev('verify.changes')]
const samePatch = [start('build', 'r3'), ev('build.submitted', { runId: 'r3' })]
const secondPatch = [start('build', 'r3'), ev('build.submitted', { runId: 'r3', patchId: 'p2' })]
const checked = ev('checks.finished')
const firstRound = [...inVerify, reviewed, checked, ...changed]

const CASES: Case[] = [
  { name: 'a new patch is reviewed while its checks are pending', events: inVerify, expected: reviewer },
  { name: 'a live review run waits on the run', events: [...inVerify, start('verify', 'r2')], expected: waitRun },
  { name: 'finished checks do not skip the review', events: [...inVerify, checked], expected: reviewer },
  { name: 'a reviewed patch waits on the checks', events: [...inVerify, reviewed], expected: waitChecks },
  {
    name: 'a reviewed patch with finished checks runs the verifier',
    events: [...inVerify, reviewed, checked],
    expected: verifier,
  },
  {
    name: 'a resubmitted patch needs a new review even with the same patch id',
    events: [...firstRound, ...samePatch],
    expected: reviewer,
  },
  {
    name: 'a new patch needs a new review',
    events: [...firstRound, ...secondPatch, ev('checks.finished', { patchId: 'p2' })],
    expected: reviewer,
  },
  {
    name: 'a review of the new patch waits for its checks',
    events: [...firstRound, ...secondPatch, ev('review.submitted', { patchId: 'p2' })],
    expected: waitChecks,
  },
  {
    name: 'a ticket that passed Verify before the review existed ends where it ended',
    events: [...inVerify, checked, start('verify', 'r2'), ev('verify.passed')],
    expected: merge,
  },
]

describe('next with the review run', () => {
  it.each(CASES)('$name', (c) => {
    expect(next(briefed(), fold(c.events), CONFIG)).toEqual(c.expected)
  })
})
