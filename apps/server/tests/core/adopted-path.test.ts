import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, foldOptions, next, type Config, type Step, type WaitOn } from '../../src/core/lifecycle'
import type { TicketRecord } from '../../src/core/record/schema'
import { recordSchema } from '../../src/core/record/schema'
import { adoptedSource, adoptEvent, briefed, CONFIG, decision, ev, fail, inVerify, start } from './fixtures'

type Case = { name: string; events: AppEvent[]; expected: Step; config?: Partial<Config>; record?: TicketRecord }

const run = (stage: 'brief' | 'build' | 'verify', role: 'builder' | 'reviewer' | 'verifier' = 'builder'): Step => ({
  kind: 'run',
  stage,
  role,
})
const wait = (on: WaitOn): Step => ({ kind: 'wait', on })
const question = (reason: string, options: string[]): Step => ({ kind: 'card', card: 'question', reason, options })
const resultCard: Step = { kind: 'card', card: 'result', reason: 'result', options: [] }
const verifyRounds = question('verify-rounds', ['one-more-round', 'accept-as-is', 'discard'])
const merge: Step = { kind: 'effect', effect: 'merge' }
const reviewerRun = run('verify', 'reviewer')

const adopted = briefed({ source: adoptedSource })
const backlogAdopted = briefed({ source: { ...adoptedSource, backlog: true } })
const checksDone = ev('checks.finished', { patchId: 'adopted:h1' })
const checksDoneAt = (sha: string) => ev('checks.finished', { patchId: `adopted:${sha}` })
const reviewedAt = (sha = 'h1') => ev('review.submitted', { patchId: `adopted:${sha}` })
const changed = (runId: string) => [start('verify', runId), ev('verify.changes', { runId })]
const briefWritten = [adoptEvent(), start('brief'), ev('brief.submitted')]
const approved = [...briefWritten, ev('brief.approved', { by: 'owner' })]
const verifying = [...approved, reviewedAt(), checksDone]
const passed = [...verifying, start('verify', 'r2'), ev('verify.passed', { runId: 'r2', patchId: 'adopted:h1' })]
const sentBack = [...passed, ev('result.sent-back')]
const mergedByPerson = [...verifying, ev('ship.merged')]
const secondCommit = [adoptEvent('h2'), reviewedAt('h2'), checksDoneAt('h2')]
const atCap = [...verifying, ...changed('r2'), ...secondCommit, ...changed('r3')]
const mergedAndPassed = [
  ...mergedByPerson,
  start('verify', 'r2'),
  ev('verify.passed', { runId: 'r2', patchId: 'adopted:h1' }),
]
const released = ev('run.released', { stage: 'verify', runId: 'r2' })
const gated = { productionGate: true }
const closedOnForge = ev('ticket.closed', { reason: 'closed-on-forge' })

const CASES: Case[] = [
  { name: 'an adopted pull request skips intake and runs the Brief', events: [adoptEvent()], expected: run('brief') },
  {
    name: 'a Brief of an adopted ticket is not gated by backlog',
    events: briefWritten,
    expected: { kind: 'emit', event: ev('brief.approved', { by: 'rule' }) },
    record: backlogAdopted,
  },
  {
    name: 'an open decision still gates the Brief of an adopted ticket',
    events: briefWritten,
    record: briefed({ source: adoptedSource, decisions: [decision(1)] }),
    expected: { kind: 'card', card: 'brief', reason: 'open-decision', options: [] },
  },
  {
    name: 'a risk area still gates the Brief of an adopted ticket',
    events: briefWritten,
    record: briefed({ source: adoptedSource, risk: { door: 'two-way', areas: ['security'], rollback: 'r' } }),
    expected: { kind: 'card', card: 'brief', reason: 'risk-area', options: [] },
  },
  { name: 'an approved Brief goes to Verify and is reviewed at once', events: approved, expected: reviewerRun },
  {
    name: 'a reviewed pull request waits for the checks',
    events: [...approved, reviewedAt()],
    expected: wait('checks'),
  },
  { name: 'passed checks run the verifier', events: verifying, expected: run('verify', 'verifier') },
  {
    name: 'without required checks a reviewed pull request runs the verifier at once',
    events: [...approved, reviewedAt()],
    config: { requiredChecks: false },
    expected: run('verify', 'verifier'),
  },
  { name: 'verify.changes waits on the author', events: [...verifying, ...changed('r2')], expected: wait('author') },
  {
    name: 'a new head commit is reviewed again',
    events: [...verifying, ...changed('r2'), adoptEvent('h2')],
    expected: reviewerRun,
  },
  {
    name: 'a reviewed new head commit waits for its checks, then runs the verifier again',
    events: [...verifying, ...changed('r2'), adoptEvent('h2'), reviewedAt('h2')],
    expected: wait('checks'),
  },
  {
    name: 'a new head commit with finished checks runs the verifier again',
    events: [...verifying, ...changed('r2'), ...secondCommit],
    expected: run('verify', 'verifier'),
  },
  { name: 'the verify cap ends in the existing question', events: atCap, expected: verifyRounds },
  {
    name: 'the round that is granted waits for the next commit of the author',
    events: [...atCap, ev('question.asked'), ev('question.answered', { option: 'one-more-round' })],
    expected: wait('author'),
  },
  {
    name: 'a granted round runs the verifier once the author committed',
    events: [
      ...atCap,
      ev('question.asked'),
      ev('question.answered', { option: 'one-more-round' }),
      ...[adoptEvent('h3'), reviewedAt('h3'), checksDoneAt('h3')],
    ],
    expected: run('verify', 'verifier'),
  },
  {
    name: 'accept-as-is at the cap shows the Result card before any merge',
    events: [
      ...atCap,
      ev('question.asked'),
      ev('question.answered', { option: 'accept-as-is' }),
      ev('verify.overridden', { patchId: 'adopted:h2', headSha: 'h2' }),
    ],
    expected: resultCard,
  },
  { name: 'a verified adopted patch shows the Result card before the merge', events: passed, expected: resultCard },
  { name: 'the accept merges the pull request', events: [...passed, ev('result.accepted')], expected: merge },
  {
    name: 'a merged pull request after the accept is done',
    events: [...passed, ev('result.accepted'), ev('ship.merged')],
    expected: { kind: 'done' },
  },
  {
    name: 'the production gate comes after the merge',
    events: [...passed, ev('result.accepted'), ev('ship.merged')],
    config: gated,
    expected: question('production', ['approve', 'hold']),
  },
  {
    name: 'a merge after the accept waits for the deploy when deploy checks are on',
    events: [...passed, ev('result.accepted'), ev('ship.merged')],
    config: { deployChecks: true },
    expected: wait('deploy'),
  },
  { name: 'a merge by a person still goes to the Result card', events: mergedByPerson, expected: resultCard },
  {
    name: 'a pull request merged by a person is done once the owner accepted',
    events: [...mergedByPerson, ev('result.accepted')],
    expected: { kind: 'done' },
  },
  { name: 'a send-back waits on the author', events: sentBack, expected: wait('author') },
  {
    name: 'a commit after a send-back is verified again',
    events: [...sentBack, ...secondCommit],
    expected: run('verify', 'verifier'),
  },
  {
    name: 'a new commit while the Result card is open sends the ticket back to the checks',
    events: [...passed, adoptEvent('h2'), reviewedAt('h2')],
    expected: wait('checks'),
  },
  {
    name: 'a new commit that released the live Verify run waits for its checks, without a failed run',
    events: [...verifying, start('verify', 'r2'), adoptEvent('h2'), reviewedAt('h2'), released],
    expected: wait('checks'),
  },
  {
    name: 'a released Verify run is verified again once the checks of the new commit finished',
    events: [...verifying, start('verify', 'r2'), ...secondCommit, released],
    expected: run('verify', 'verifier'),
  },
  {
    name: 'a send-back after a person merged the pull request goes to Build with the note',
    events: [...mergedAndPassed, ev('result.sent-back')],
    expected: run('build'),
  },
  { name: 'a closed pull request is done', events: [...verifying, closedOnForge], expected: { kind: 'done' } },
  { name: 'a live verify run waits on the run', events: [...verifying, start('verify', 'r2')], expected: wait('run') },
  {
    name: 'failed runs at the cap raise the existing question at Verify',
    events: [...verifying, start('verify', 'r2'), fail('verify', 'r2'), start('verify', 'r3'), fail('verify', 'r3')],
    expected: question('failed-runs', ['retry', 'retry-with-guidance', 'discard']),
  },
]

describe('next on the adopted path', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const config = { ...CONFIG, ...c.config }
    const state = fold(c.events, foldOptions(config))
    expect(next(c.record ?? adopted, state, config)).toEqual(c.expected)
  })

  it('never asks for a Build run on any prefix of the adopted path', () => {
    const path = [...passed, ev('result.accepted'), ev('ship.merged')]
    const all = [...atCap, ...path, ...sentBack, ...secondCommit]
    for (let n = 1; n <= all.length; n++) {
      const step = next(adopted, fold(all.slice(0, n), foldOptions(CONFIG)), CONFIG)
      expect(step.kind === 'run' ? step.stage : 'none').not.toBe('build')
      expect(step.kind === 'run' ? step.stage : 'none').not.toBe('intake')
    }
  })
})

describe('fold on the adopted path', () => {
  const options = foldOptions(CONFIG)

  it('enters the Brief with the adopted patch and pending checks', () => {
    expect(fold([adoptEvent()], options)).toMatchObject({
      stage: 'brief',
      adopted: true,
      patch: { id: 'adopted:h1', pr: 12, headSha: 'h1' },
      checks: 'pending',
      verdict: null,
    })
  })

  it('records no pending checks when the Product requires none', () => {
    expect(fold([adoptEvent()], foldOptions({ ...CONFIG, requiredChecks: false })).checks).toBe('none')
  })

  it('approving the Brief enters Verify and keeps the adopted patch', () => {
    expect(fold(approved, options)).toMatchObject({ stage: 'verify', brief: 'approved', patch: { pr: 12 } })
  })

  it('verify.changes stays in Verify, counts the round and waits on the author', () => {
    expect(fold([...verifying, ...changed('r2')], options)).toMatchObject({
      stage: 'verify',
      verifyRounds: 1,
      waitingAuthor: true,
      verdict: null,
    })
  })

  it('a new head commit replaces the patch, clears the wait and re-enters Verify from Ship', () => {
    const state = fold([...passed, adoptEvent('h2')], options)
    expect(state).toMatchObject({
      stage: 'verify',
      waitingAuthor: false,
      verdict: null,
      checks: 'pending',
      patch: { id: 'adopted:h2', headSha: 'h2' },
    })
  })

  it('a send-back waits on the author in Verify and clears the acceptance', () => {
    expect(fold(sentBack, options)).toMatchObject({ stage: 'verify', waitingAuthor: true, accepted: false })
  })

  it('a merge by a person at Verify moves the ticket to Ship', () => {
    expect(fold(mergedByPerson, options)).toMatchObject({ stage: 'ship', merged: true })
  })

  it('an accept before the merge does not finish the ticket', () => {
    const state = fold([...passed, ev('result.accepted')], options)
    expect(state).toMatchObject({ stage: 'ship', accepted: true, merged: false })
  })

  it('the merge after the accept finishes the ticket', () => {
    expect(fold([...passed, ev('result.accepted'), ev('ship.merged')], options).stage).toBe('done')
  })

  it('a release of a live Verify run counts no failed run', () => {
    const state = fold([...verifying, start('verify', 'r2'), adoptEvent('h2'), released], options)
    expect(state).toMatchObject({ failedRuns: 0, run: null, stage: 'verify' })
  })

  it('a send-back after a merge by a person continues as an ordinary ticket in Build', () => {
    const state = fold([...mergedAndPassed, ev('result.sent-back', { note: 'fix the label' })], options)
    expect(state).toMatchObject({ stage: 'build', adopted: false, accepted: false, note: 'fix the label' })
  })

  it('leaves an ordinary ticket without the adopted state', () => {
    expect(fold(inVerify, options)).toMatchObject({ adopted: false, waitingAuthor: false })
  })
})

describe('an ordinary ticket next to the adopted path', () => {
  it('still goes back to Build after verify.changes and builds before the merge', () => {
    const events = [...inVerify, ev('checks.finished'), ...changed('r2')]
    const step = next(briefed(), fold(events, foldOptions(CONFIG)), CONFIG)
    expect(step).toEqual({ kind: 'run', stage: 'build', role: 'builder' })
    expect(fold(events, foldOptions(CONFIG))).toMatchObject({ adopted: false, waitingAuthor: false, stage: 'build' })
  })

  it('keeps the backlog gate for a backlog ticket that is not adopted', () => {
    const record = briefed({ source: { ...adoptedSource, adopted: undefined, backlog: true } })
    const state = fold([ev('intake.accepted'), start('brief'), ev('brief.submitted')], foldOptions(CONFIG))
    expect(next(record, state, CONFIG)).toEqual({ kind: 'card', card: 'brief', reason: 'backlog', options: [] })
  })

  it('parses a stored record without source.adopted and one with it', () => {
    expect(recordSchema.parse(briefed()).source.adopted).toBeUndefined()
    expect(recordSchema.parse(adopted).source.adopted).toEqual({ pr: 12 })
    const invalid = { ...adopted, source: { ...adopted.source, adopted: { pr: 0 } } }
    expect(recordSchema.safeParse(invalid).success).toBe(false)
  })
})
