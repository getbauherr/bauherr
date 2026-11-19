import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next, type Config, type Step } from '../../src/core/lifecycle'
import type { TicketRecord } from '../../src/core/record/schema'
import {
  answered,
  briefed,
  CONFIG,
  decision,
  ev,
  fail,
  inBrief,
  inBuild,
  inShip,
  inVerify,
  merged,
  source,
  start,
} from './fixtures'

type Case = { name: string; events: AppEvent[]; expected: Step; config?: Partial<Config>; record?: TicketRecord }

const run = (stage: 'intake' | 'brief' | 'build' | 'verify', role: 'builder' | 'verifier' = 'builder'): Step => ({
  kind: 'run',
  stage,
  role,
})
const wait = (on: 'reporter' | 'run' | 'checks' | 'deploy' | 'owner'): Step => ({ kind: 'wait', on })
const question = (reason: string, options: string[]): Step => ({ kind: 'card', card: 'question', reason, options })
const briefCard = (reason: string): Step => ({ kind: 'card', card: 'brief', reason, options: [] })
const resultCard: Step = { kind: 'card', card: 'result', reason: 'result', options: [] }
const approvedByRule: Step = { kind: 'emit', event: ev('brief.approved', { by: 'rule' }) }
const asked = (round: number) => ev('intake.asked', { round })
const round = (n: number) => [asked(n), ev('reporter.silent')]
const changed = [start('verify', 'r2'), ev('verify.changes')]
const gated = { productionGate: true }
const external = { ...source, external: true }
const twoFails = [start('intake'), fail('intake'), start('intake', 'r2'), fail('intake', 'r2')]
const answeredQuestion = (option = 'retry') => [ev('question.asked'), ev('question.answered', { option })]
const secondBuild = [start('build', 'r3'), ev('build.submitted', { runId: 'r3' })]
const atVerifyCap = [...inVerify, ...changed, ...secondBuild, ...changed]
const briefWritten = [...inBrief, start('brief'), ev('brief.submitted')]
const noted = [...briefWritten, ev('brief.changes-requested')]
const merge: Step = { kind: 'effect', effect: 'merge' }
const verifyRounds = question('verify-rounds', ['one-more-round', 'accept-as-is', 'discard'])
const disputed = question('disputed', ['not-a-bug', 'accept', 'ask-again'])
const sentBack = [...merged, ev('result.sent-back')]
const secondPatch = [start('build', 'r3'), ev('build.submitted', { runId: 'r3', patchId: 'p2' })]

const CASES: Case[] = [
  { name: 'closed at intake is done', events: [ev('intake.closed')], expected: { kind: 'done' } },
  { name: 'a discarded brief is done', events: [...inBrief, ev('brief.discarded')], expected: { kind: 'done' } },
  { name: 'accepted without the gate is done', events: [...merged, ev('result.accepted')], expected: { kind: 'done' } },
  {
    name: 'closed beats an open card',
    events: [ev('question.asked'), ev('intake.closed')],
    expected: { kind: 'done' },
  },
  { name: 'an open card waits on the owner', events: [ev('question.asked')], expected: wait('owner') },
  {
    name: 'an open card beats a live run',
    events: [start('intake'), ev('question.asked')],
    expected: wait('owner'),
  },
  { name: 'a live run waits on the run', events: [start('intake')], expected: wait('run') },
  {
    name: 'a live run beats the failed-run cap',
    events: [...twoFails, start('intake', 'r3')],
    expected: wait('run'),
  },
  {
    name: 'failed runs below the cap run again',
    events: [start('intake'), fail('intake')],
    expected: run('intake'),
  },
  {
    name: 'failed runs at the cap raise a question',
    events: twoFails,
    expected: question('failed-runs', ['retry', 'retry-with-guidance', 'discard']),
  },
  {
    name: 'a released run is not a failure',
    events: [
      start('intake'),
      ev('run.released', { stage: 'intake' }),
      start('intake', 'r2'),
      ev('run.released', { stage: 'intake', runId: 'r2' }),
    ],
    expected: run('intake'),
  },
  {
    name: 'failed-run cap respects the configured cap',
    events: [start('intake'), fail('intake')],
    config: { caps: { ...CONFIG.caps, failedRuns: 1 } },
    expected: question('failed-runs', ['retry', 'retry-with-guidance', 'discard']),
  },
  {
    name: 'a failed-run question once answered runs again',
    events: [...twoFails, ...answeredQuestion()],
    expected: run('intake'),
  },
  {
    name: 'a failed-run counter starts over in a new stage',
    events: [...twoFails, ...answeredQuestion(), ev('intake.accepted'), start('brief', 'r3'), fail('brief', 'r3')],
    expected: run('brief'),
  },
  { name: 'a fresh ticket runs intake', events: [], expected: run('intake') },
  { name: 'questions to the reporter wait on the reporter', events: [asked(1)], expected: wait('reporter') },
  { name: 'a reply runs intake again', events: [asked(1), ev('reporter.replied')], expected: run('intake') },
  { name: 'silence below the round cap runs intake again', events: round(1), expected: run('intake') },
  {
    name: 'silence at the round cap raises a question',
    events: [...round(1), ...round(2)],
    expected: question('reporter-silent', ['close', 'ask-again', 'accept']),
  },
  {
    name: 'a reporter-silent question once answered runs intake',
    events: [...round(1), ...round(2), ev('question.asked'), ev('question.answered')],
    expected: run('intake'),
  },
  {
    name: 'a dispute raises a question',
    events: [ev('intake.disputed')],
    expected: disputed,
  },
  {
    name: 'a dispute once answered runs intake',
    events: [ev('intake.disputed'), ev('question.asked'), ev('question.answered')],
    expected: run('intake'),
  },
  {
    name: 'a dispute after silence is the dispute',
    events: [...round(1), ...round(2), ev('intake.disputed')],
    expected: disputed,
  },
  { name: 'accepted intake runs the brief', events: inBrief, expected: run('brief') },
  { name: 'a brief without a gate reason is approved by rule', events: briefWritten, expected: approvedByRule },
  {
    name: 'a gated brief becomes a card',
    events: briefWritten,
    record: briefed({ source: { ...source, backlog: true } }),
    expected: briefCard('backlog'),
  },
  {
    name: 'an open decision becomes a card',
    events: briefWritten,
    record: briefed({ decisions: [decision(1)] }),
    expected: briefCard('open-decision'),
  },
  {
    name: 'an answered decision passes the gate',
    events: briefWritten,
    record: briefed({ decisions: [decision(1, answered)] }),
    expected: approvedByRule,
  },
  {
    name: 'a one-way door becomes a card',
    events: briefWritten,
    record: briefed({ risk: { door: 'one-way', areas: [], rollback: 'r' } }),
    expected: briefCard('one-way-door'),
  },
  {
    name: 'a configured risk area becomes a card',
    events: briefWritten,
    record: briefed({ risk: { door: 'two-way', areas: ['security'], rollback: 'r' } }),
    expected: briefCard('risk-area'),
  },
  {
    name: 'an external feature becomes a card',
    events: briefWritten,
    record: briefed({ source: external, type: 'feature' }),
    expected: briefCard('external-request'),
  },
  {
    name: 'the gate uses the configured risk areas',
    events: briefWritten,
    record: briefed({ risk: { door: 'two-way', areas: ['security'], rollback: 'r' } }),
    config: { riskAreas: [] },
    expected: approvedByRule,
  },
  {
    name: 'an owner note on the brief runs the brief again',
    events: noted,
    expected: run('brief'),
  },
  {
    name: 'a consumed note falls back to the gate',
    events: [...noted, start('brief', 'r2'), ev('brief.submitted', { runId: 'r2' })],
    expected: approvedByRule,
  },
  { name: 'an approved brief runs build', events: inBuild, expected: run('build') },
  {
    name: 'one verify round below the cap runs build',
    events: [...inVerify, ...changed],
    expected: run('build'),
  },
  {
    name: 'verify rounds at the cap raise a question',
    events: atVerifyCap,
    expected: verifyRounds,
  },
  {
    name: 'one more round allows another build',
    events: [...atVerifyCap, ...answeredQuestion('one-more-round')],
    expected: run('build'),
  },
  {
    name: 'one more round is used up by the next verify round',
    events: [
      ...atVerifyCap,
      ...answeredQuestion('one-more-round'),
      start('build', 'r4'),
      ev('build.submitted', { runId: 'r4' }),
      ...changed,
    ],
    expected: verifyRounds,
  },
  {
    name: 'the verify-round cap respects the configuration',
    events: [...inVerify, ...changed],
    config: { caps: { ...CONFIG.caps, verifyRounds: 1 } },
    expected: verifyRounds,
  },
  { name: 'pending checks wait on the checks', events: inVerify, expected: wait('checks') },
  {
    name: 'passed checks run the verifier',
    events: [...inVerify, ev('checks.finished')],
    expected: run('verify', 'verifier'),
  },
  {
    name: 'failed checks still go to the verifier',
    events: [...inVerify, ev('checks.finished', { passed: false })],
    expected: run('verify', 'verifier'),
  },
  { name: 'a verified patch is merged', events: inShip, expected: merge },
  {
    name: 'a merged patch waits for the deploy when deploy checks are on',
    events: merged,
    config: { deployChecks: true },
    expected: wait('deploy'),
  },
  { name: 'a merged patch needs no deploy wait when checks are off', events: merged, expected: resultCard },
  {
    name: 'a deployed patch raises the result card',
    events: [...merged, ev('ship.deployed')],
    config: { deployChecks: true },
    expected: resultCard,
  },
  {
    name: 'an accepted result needs production approval when the gate is on',
    events: [...merged, ev('result.accepted')],
    config: gated,
    expected: question('production', ['approve', 'hold']),
  },
  {
    name: 'an approved production is done when the gate is on',
    events: [...merged, ev('result.accepted'), ev('production.approved')],
    config: gated,
    expected: { kind: 'done' },
  },
  {
    name: 'approval before acceptance still waits for acceptance',
    events: [...merged, ev('production.approved')],
    config: gated,
    expected: resultCard,
  },
  {
    name: 'a result sent back after ship runs build with the note',
    events: sentBack,
    expected: run('build'),
  },
  {
    name: 'a new patch after send-back is verified again, then merged again',
    events: [
      ...sentBack,
      ...secondPatch,
      ev('checks.finished', { patchId: 'p2' }),
      start('verify', 'r4'),
      ev('verify.passed', { runId: 'r4', patchId: 'p2' }),
    ],
    expected: merge,
  },
]

describe('next', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const config = { ...CONFIG, ...c.config }
    const state = fold(c.events, { productionGate: config.productionGate })
    expect(next(c.record ?? briefed(), state, config)).toEqual(c.expected)
  })
})
