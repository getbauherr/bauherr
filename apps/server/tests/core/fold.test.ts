import { describe, expect, it } from 'vitest'
import { fold } from '../../src/core/lifecycle'
import { ev, fail, inBrief, inBuild, inShip, inVerify, merged, start } from './fixtures'

describe('fold', () => {
  it('starts at intake with nothing established', () => {
    expect(fold([])).toMatchObject({
      stage: 'intake',
      closed: null,
      card: null,
      run: null,
      reporter: { rounds: 0, waiting: false },
      verifyRounds: 0,
      failedRuns: 0,
      brief: 'none',
      patch: null,
      checks: 'none',
      verdict: null,
      merged: false,
      deployed: false,
      accepted: false,
      productionApproved: false,
      productionHeld: false,
      overridden: false,
      note: null,
    })
  })

  it('moves the stage on each lifecycle event', () => {
    expect(fold(inBrief).stage).toBe('brief')
    expect(fold(inBuild).stage).toBe('build')
    expect(fold(inVerify).stage).toBe('verify')
    expect(fold(inShip).stage).toBe('ship')
    expect(fold([...inShip, ev('result.accepted')]).stage).toBe('done')
  })

  it('closes at intake and on discard', () => {
    expect(fold([ev('intake.closed', { reason: 'duplicate' })]).closed).toBe('duplicate')
    expect(fold([...inBrief, ev('brief.discarded')]).closed).toBe('discarded')
  })

  it('tracks the reporter', () => {
    const asked = fold([ev('intake.asked', { round: 1 })])
    expect(asked.reporter).toEqual({ rounds: 1, waiting: true })
    expect(fold([ev('intake.asked', { round: 1 }), ev('reporter.replied')]).reporter).toEqual({
      rounds: 1,
      waiting: false,
    })
    expect(fold([ev('intake.asked', { round: 2 }), ev('reporter.silent')]).reporter).toEqual({
      rounds: 2,
      waiting: false,
    })
  })

  it('keeps a run live until a submit of that run, a failure or a release', () => {
    expect(fold([start('intake')]).run).toEqual({ stage: 'intake', runId: 'r1', fingerprint: 'fp' })
    expect(fold([...inBrief, start('brief'), ev('brief.submitted')]).run).toBeNull()
    expect(fold([start('intake'), fail('intake')]).run).toBeNull()
    expect(fold([start('intake'), ev('run.released', { stage: 'intake' })]).run).toBeNull()
    expect(fold([start('brief', 'r2'), ev('brief.submitted', { runId: 'r1' })]).run?.runId).toBe('r2')
  })

  it('ends a live intake run with the intake event it produced', () => {
    expect(fold([start('intake'), ev('intake.accepted')]).run).toBeNull()
    expect(fold([start('intake'), ev('intake.asked')]).run).toBeNull()
    expect(fold([start('intake'), ev('intake.disputed')]).run).toBeNull()
    expect(fold([start('intake', 'r1'), fail('intake', 'r1'), start('intake', 'r2'), ev('intake.accepted')]))
      .toMatchObject({ run: null, failedRuns: 0 })
  })

  it('ends the build run with build.submitted and the verify run with its verdict', () => {
    expect(fold([...inBuild, start('build'), ev('build.submitted')]).run).toBeNull()
    expect(fold([...inVerify, start('verify', 'r2'), ev('verify.changes')]).run).toBeNull()
    expect(fold([...inVerify, start('verify', 'r2'), ev('verify.passed')]).run).toBeNull()
  })

  it('counts consecutive failed runs and resets them on a submit, a stage change or an answer', () => {
    const twice = [start('intake'), fail('intake'), start('intake', 'r2'), fail('intake', 'r2')]
    expect(fold(twice).failedRuns).toBe(2)
    expect(fold([...twice, ev('intake.accepted')]).failedRuns).toBe(0)
    const retried = [...inBrief, start('brief'), fail('brief'), start('brief', 'r2')]
    expect(fold([...retried, ev('brief.submitted', { runId: 'r2' })]).failedRuns).toBe(0)
    expect(fold([...twice, ev('question.asked'), ev('question.answered')]).failedRuns).toBe(0)
    expect(fold([...inBrief, start('brief'), fail('brief')]).failedRuns).toBe(1)
  })

  it('counts verify rounds and sends the ticket back to build', () => {
    const changes = fold([...inVerify, start('verify', 'r2'), ev('verify.changes')])
    expect(changes).toMatchObject({ stage: 'build', verifyRounds: 1, verdict: null })
  })

  it('keeps the latest patch and its checks', () => {
    expect(fold(inVerify)).toMatchObject({ patch: { id: 'p1', pr: 12 }, checks: 'pending' })
    expect(fold([...inVerify, ev('checks.finished', { passed: false })]).checks).toBe('failed')
    expect(fold([...inVerify, ev('checks.finished', { passed: true })]).checks).toBe('passed')
    expect(fold([...inVerify, ev('checks.finished', { patchId: 'old', passed: true })]).checks).toBe('pending')
    expect(fold([...inVerify, ev('checks.finished'), ev('build.submitted', { patchId: 'p2', pr: 13 })])).toMatchObject({
      patch: { id: 'p2', pr: 13 },
      checks: 'pending',
    })
  })

  it('records the verdict, merge, deploy and acceptance', () => {
    expect(fold(inShip).verdict).toBe('p1')
    expect(fold(merged).merged).toBe(true)
    expect(fold([...merged, ev('ship.deployed')]).deployed).toBe(true)
    expect(fold([...merged, ev('result.accepted')]).accepted).toBe(true)
  })

  it('keeps the ticket in ship until production is approved when the gate is on', () => {
    const accepted = [...merged, ev('result.accepted')]
    expect(fold(accepted, { productionGate: true }).stage).toBe('ship')
    expect(fold([...accepted, ev('production.approved')], { productionGate: true }).stage).toBe('done')
    expect(fold([ev('production.approved'), ...accepted], { productionGate: true }).stage).toBe('done')
  })

  it('sends a ticket back to build after ship and starts the ship facts over with the next patch', () => {
    const back = fold([...merged, ev('ship.deployed'), ev('result.sent-back')])
    expect(back).toMatchObject({ stage: 'build', note: 'not yet', accepted: false })
    const patched = [start('build', 'r3'), ev('build.submitted', { runId: 'r3', patchId: 'p2' })]
    const again = fold([...merged, ev('result.sent-back'), ...patched])
    expect(again).toMatchObject({ stage: 'verify', merged: false, deployed: false, verdict: null })
  })

  it('keeps the owner note until a later run consumes it', () => {
    const asked = [...inBrief, start('brief'), ev('brief.submitted'), ev('brief.changes-requested')]
    expect(fold(asked).note).toBe('shorter')
    expect(fold([...asked, start('brief', 'r2')]).note).toBeNull()
    expect(fold([...merged, ev('result.sent-back')]).note).toBe('not yet')
    expect(fold([...merged, ev('result.sent-back'), start('build', 'r3')]).note).toBeNull()
  })

  it('sets the note from the owner until the next run starts', () => {
    expect(fold([...inBuild, ev('owner.note')]).note).toBe('try the other way')
    expect(fold([...inBuild, ev('owner.note'), start('build', 'r3')]).note).toBeNull()
  })

  it('closes the ticket when the owner discards it', () => {
    expect(fold([...inBuild, ev('ticket.closed')]).closed).toBe('discarded')
  })

  it('treats an override of the latest patch like a passed verify for the stage change', () => {
    const changes = [...inVerify, start('verify', 'r2'), ev('verify.changes')]
    const overridden = fold([...changes, ev('verify.overridden')])
    expect(overridden).toMatchObject({ stage: 'ship', verdict: 'p1', overridden: true, failedRuns: 0 })
    expect(fold(inShip).overridden).toBe(false)
  })

  it('ignores an override of a patch that is not the latest', () => {
    const changes = [...inVerify, start('verify', 'r2'), ev('verify.changes')]
    expect(fold([...changes, ev('verify.overridden', { patchId: 'old' })])).toMatchObject({
      stage: 'build',
      overridden: false,
    })
  })

  it('starts the override over with the next patch', () => {
    const changes = [...inVerify, start('verify', 'r2'), ev('verify.changes'), ev('verify.overridden')]
    const patched = [start('build', 'r3'), ev('build.submitted', { runId: 'r3', patchId: 'p2' })]
    expect(fold([...changes, ...patched])).toMatchObject({ stage: 'verify', overridden: false })
  })

  it('remembers a held production until a new patch', () => {
    const held = [...merged, ev('result.accepted'), ev('production.held')]
    expect(fold(held, { productionGate: true })).toMatchObject({ productionHeld: true, stage: 'ship' })
    const back = fold([...held, ev('result.sent-back')], { productionGate: true })
    expect(back.productionHeld).toBe(true)
    const patched = [start('build', 'r3'), ev('build.submitted', { runId: 'r3', patchId: 'p2' })]
    expect(fold([...held, ev('result.sent-back'), ...patched], { productionGate: true }).productionHeld).toBe(false)
  })

  it('opens a question card until it is answered', () => {
    const asked = fold([ev('question.asked', { reason: 'failed-runs', options: ['retry', 'discard'] })])
    expect(asked.card).toEqual({ card: 'question', reason: 'failed-runs', options: ['retry', 'discard'] })
    expect(fold([ev('question.asked'), ev('question.answered')]).card).toBeNull()
  })

  it('remembers the latest event', () => {
    expect(fold([]).last).toBeNull()
    expect(fold([ev('intake.disputed')]).last).toBe('intake.disputed')
  })
})
