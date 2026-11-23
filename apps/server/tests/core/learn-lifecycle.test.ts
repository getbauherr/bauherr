import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next } from '../../src/core/lifecycle'
import type { Finding, TicketRecord } from '../../src/core/record/schema'
import { briefed, CONFIG, ev, fail, inBuild, merged, start } from './fixtures'

const fixed: Finding = {
  id: 'f1',
  axis: 'spec',
  text: 'The list drops the last row',
  evidence: { kind: 'repro', pointer: 'open the list' },
  status: 'fixed',
}

const accepted = [...merged, ev('result.accepted')]
const learnRun = { kind: 'run', stage: 'done', role: 'reviewer' }
const stepFor = (events: AppEvent[], record: TicketRecord = briefed()) => next(record, fold(events), CONFIG)

describe('when Learn runs', () => {
  it('runs for an accepted ticket whose record holds a fixed finding', () => {
    expect(stepFor(accepted, briefed({ findings: [fixed] }))).toEqual(learnRun)
  })

  it('runs for an accepted ticket the owner sent back', () => {
    const sentBack = [...merged, ev('result.sent-back'), ...merged.slice(-3), ev('result.accepted')]
    expect(stepFor(sentBack)).toEqual(learnRun)
  })

  it('runs for an accepted ticket the owner asked Brief changes for', () => {
    const changes = [...inBuild.slice(0, 3), ev('brief.changes-requested'), ...inBuild.slice(3)]
    expect(stepFor([...changes, ...merged.slice(inBuild.length), ev('result.accepted')])).toEqual(learnRun)
  })

  it('does not run for an accepted ticket nothing corrected, or one whose findings were not fixed', () => {
    expect(stepFor(accepted)).toEqual({ kind: 'done' })
    expect(stepFor(accepted, briefed({ findings: [{ ...fixed, status: 'invalid' }] }))).toEqual({ kind: 'done' })
  })

  it('does not run for a discarded, archived or restored-and-closed ticket', () => {
    const corrected = briefed({ findings: [fixed] })
    expect(stepFor([...accepted, ev('ticket.closed', { reason: 'discarded' })], corrected)).toEqual({ kind: 'done' })
    expect(stepFor([...accepted, ev('ticket.closed', { reason: 'archived' })], corrected)).toEqual({ kind: 'done' })
    expect(stepFor([...inBuild, ev('brief.discarded')], corrected)).toEqual({ kind: 'done' })
  })

  it('does not run for a ticket that was done elsewhere, without an accepted Result', () => {
    expect(stepFor([...inBuild, ev('ticket.done-elsewhere')], briefed({ findings: [fixed] }))).toEqual({ kind: 'done' })
  })

  it('waits for the live run and is done once Learn submitted or was skipped', () => {
    const corrected = briefed({ findings: [fixed] })
    expect(stepFor([...accepted, start('done', 'r9')], corrected)).toEqual({ kind: 'wait', on: 'run' })
    const submitted = [...accepted, start('done', 'r9'), ev('learn.submitted', { runId: 'r9' })]
    expect(stepFor(submitted, corrected)).toEqual({ kind: 'done' })
    expect(stepFor([...accepted, ev('learn.skipped')], corrected)).toEqual({ kind: 'done' })
  })

  it('gives up with learn.skipped after two failed runs, and asks no question', () => {
    const failed = [...accepted, start('done', 'r8'), fail('done', 'r8'), start('done', 'r9'), fail('done', 'r9')]
    const step = stepFor(failed, briefed({ findings: [fixed] }))
    expect(step).toEqual({ kind: 'emit', event: ev('learn.skipped', { reason: 'the Learn run failed twice' }) })
    const after = fold([...failed, ev('learn.skipped')])
    expect(after.learned).toBe(true)
  })

  it('keeps the ticket accepted and done in the fold while Learn is queued', () => {
    const state = fold([...accepted, start('done', 'r9')])
    expect(state).toMatchObject({ stage: 'done', accepted: true, closed: null, learned: false })
  })
})
