import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next, type Config, type Step } from '../../src/core/lifecycle'
import { briefed, CONFIG, ev, merged } from './fixtures'

const deploying: Config = { ...CONFIG, deployChecks: true, deployNames: ['deploy'] }
const stalled = ev('ship.deploy-stalled', { reason: 'failed', checks: ['deploy'] })
const asked = ev('question.asked', { reason: 'deploy-stalled', options: ['check-again', 'continue'] })
const answered = (option: string) => ev('question.answered', { option })
const resultCard: Step = { kind: 'card', card: 'result', reason: 'result', options: [] }

const stepOf = (events: AppEvent[], config: Config = deploying) =>
  next(briefed(), fold(events, { deployChecks: config.deployChecks }), config)

describe('next after a merge with deploy checks', () => {
  it('waits on the deploy', () => {
    expect(stepOf(merged)).toEqual({ kind: 'wait', on: 'deploy' })
  })

  it('asks the owner when the deploy stalled', () => {
    expect(stepOf([...merged, stalled])).toEqual({
      kind: 'card',
      card: 'question',
      reason: 'deploy-stalled',
      options: ['check-again', 'continue'],
    })
  })

  it('waits on the owner while the question is open', () => {
    expect(stepOf([...merged, stalled, asked])).toEqual({ kind: 'wait', on: 'owner' })
  })

  it('waits on the deploy again after check-again', () => {
    expect(stepOf([...merged, stalled, asked, answered('check-again')])).toEqual({ kind: 'wait', on: 'deploy' })
  })

  it('goes on to the result card after continue', () => {
    const events = [...merged, stalled, asked, answered('continue'), ev('ship.deployed')]
    expect(stepOf(events)).toEqual(resultCard)
  })

  it('ignores a stalled deploy when the Product names no deploy checks', () => {
    expect(stepOf([...merged, stalled], CONFIG)).toEqual(resultCard)
  })
})
