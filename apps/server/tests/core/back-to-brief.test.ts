import { describe, expect, it } from 'vitest'
import { AGENT_ASK, BACK_TO_BRIEF, DECISIONS } from '../../src/core/decisions'
import type { AppEvent } from '../../src/core/events'
import { canGoBack, fold, next, type Step } from '../../src/core/lifecycle'
import * as f from './fixtures'
import { briefed, briefWritten, CONFIG, ev, inBrief, inBuild, inShip, inVerify, merged, start } from './fixtures'

const asked = ev('question.asked', { reason: 'agent', options: ['Build the gaps now', 'Stop'], text: 'Which?' })
const sendBack = (note = 'redo as a redesign'): AppEvent[] => [
  ev('question.answered', { option: BACK_TO_BRIEF }),
  ev('brief.changes-requested', { note }),
]
const stepOf = (events: AppEvent[]): Step => next(briefed(), fold(events), CONFIG)
const briefRun: Step = { kind: 'run', stage: 'brief', role: 'builder' }

const history555 = [
  ...inBuild,
  start('build'),
  asked,
  ev('run.released', { stage: 'build' }),
  ev('question.answered', { option: 'Stop' }),
  ev('owner.note', { note: 'Question: Which?\nAnswer: Stop' }),
  start('build', 'r2'),
  ev('question.asked', { reason: 'agent', options: ['a', 'b'], text: 'a Build question cannot send a Ticket back' }),
  ev('run.released', { stage: 'build', runId: 'r2' }),
]

const adoptedVerdict = [
  ...briefWritten,
  f.adoptEvent(),
  ev('brief.approved', { by: 'owner' }),
  ev('checks.finished', { patchId: 'adopted:h1' }),
  start('verify', 'r2'),
  ev('verify.changes', { patchId: 'adopted:h1' }),
]

describe('sending a ticket back to Brief', () => {
  it('goes back from Build with an open agent question and closes the question', () => {
    const state = fold([...inBuild, start('build'), asked, ev('run.released', { stage: 'build' }), ...sendBack()])
    expect(state).toMatchObject({ stage: 'brief', brief: 'submitted', card: null, run: null })
    expect(state.note).toBe('redo as a redesign')
    expect(stepOf([...inBuild, start('build'), asked, ...sendBack()])).toEqual(briefRun)
  })

  it('goes back from Build with a live run and ends that run', () => {
    const state = fold([...inBuild, start('build'), ev('brief.changes-requested', { note: 'wrong' })])
    expect(state).toMatchObject({ stage: 'brief', run: null, note: 'wrong' })
    expect(stepOf([...inBuild, start('build'), ev('brief.changes-requested')])).toEqual(briefRun)
  })

  it('goes back from Verify after a verdict, adopted pull request included', () => {
    expect(fold(adoptedVerdict)).toMatchObject({ stage: 'verify', verifyRounds: 1, waitingAuthor: true })
    const state = fold([...adoptedVerdict, ev('brief.changes-requested')])
    expect(state).toMatchObject({ stage: 'brief', verifyRounds: 0, brief: 'submitted', adopted: true })
    expect(fold([...inVerify, ev('brief.changes-requested')]).stage).toBe('brief')
  })

  it('starts the counters of Build and Verify again', () => {
    const failed = ev('run.failed', { stage: 'build', runId: 'r3' })
    const capped = [...inVerify, ev('verify.changes'), start('build', 'r3'), failed]
    expect(fold(capped)).toMatchObject({ verifyRounds: 1, failedRuns: 1 })
    expect(fold([...capped, ev('brief.changes-requested')])).toMatchObject({
      verifyRounds: 0,
      extraRounds: 0,
      failedRuns: 0,
    })
  })

  it('sends the returned Brief to the owner even when the rule would approve it', () => {
    const submitted = ev('brief.submitted', { runId: 'r5' })
    const written = [...inBuild, start('build'), ...sendBack().slice(1), start('brief', 'r5'), submitted]
    expect(stepOf([...inBrief, start('brief'), ev('brief.submitted')]).kind).toBe('emit')
    expect(stepOf(written)).toMatchObject({ kind: 'card', card: 'brief', reason: 'sent-back' })
    const approved = [...written, ev('brief.approved', { by: 'owner' })]
    expect(stepOf(approved)).toMatchObject({ kind: 'run', stage: 'build' })
  })

  it('replays the history of ticket 555 plus the send-back into a Brief run', () => {
    const state = fold([...history555, ...sendBack('Stop; redo the Brief as a redesign with a mockup first')])
    expect(state).toMatchObject({ stage: 'brief', card: null, run: null })
    expect(next(briefed(), state, CONFIG)).toEqual(briefRun)
  })

  it('keeps the old behaviour of a change request before the approval', () => {
    const state = fold([...briefWritten, ev('brief.changes-requested', { note: 'shorter' })])
    expect(state).toMatchObject({ stage: 'brief', brief: 'submitted', returned: false, note: 'shorter' })
  })
})

describe('where the way back is offered', () => {
  const gone: [string, AppEvent[]][] = [
    ['Intake', []],
    ['Brief', briefWritten.slice(0, 1)],
    ['Ship', inShip],
    ['after the merge', merged],
    ['Done', [...merged, ev('result.accepted')]],
    ['a discarded ticket', [...inBuild, ev('ticket.closed')]],
    ['a merged ticket sent back after the result', [...merged, ev('result.sent-back')]],
  ]
  it.each(gone)('is not offered in %s', (_name, events) => {
    expect(canGoBack(fold(events))).toBe(false)
  })

  it('is offered in Build and Verify', () => {
    expect(canGoBack(fold([...inBuild, start('build')]))).toBe(true)
    expect(canGoBack(fold(inVerify))).toBe(true)
  })

  it('is a fixed action of the agent card and the working ticket, not of the factory cards', () => {
    const fixed = [BACK_TO_BRIEF, 'own-answer', 'drop-criteria', 'accept-anyway']
    expect(Object.keys(DECISIONS[AGENT_ASK] ?? {})).toEqual(fixed)
    expect(Object.keys(DECISIONS.working ?? {})).toEqual([BACK_TO_BRIEF])
    const factory = Object.entries(DECISIONS).filter(([ask]) => ask !== AGENT_ASK && ask !== 'working')
    expect(factory.filter(([, choices]) => BACK_TO_BRIEF in choices)).toEqual([])
  })
})
