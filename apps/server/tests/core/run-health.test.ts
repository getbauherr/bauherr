import { describe, expect, it } from 'vitest'
import { runHealth, type HealthRun } from '../../src/core/views/run-health'

const NOW = new Date('2026-11-23T12:00:00Z')
const minutesAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000)
const run = (status: string, over: Partial<HealthRun> = {}): HealthRun => ({
  status,
  role: 'builder',
  error: null,
  updatedAt: minutesAgo(1),
  startedAt: minutesAgo(5),
  ...over,
})

describe('runHealth', () => {
  it('waits for a session and offers to connect one when a queued run has none', () => {
    expect(runHealth(run('queued'), false, NOW)).toEqual({
      word: 'Waiting for a session',
      sentence: 'No builder session is connected. This run starts when one claims it.',
      action: 'connect',
    })
  })

  it('has nothing to offer when a session of the role is connected', () => {
    expect(runHealth(run('queued'), true, NOW)).toMatchObject({ word: 'Working', action: null })
  })

  it('works while a claimed run is fresh', () => {
    expect(runHealth(run('claimed', { updatedAt: minutesAgo(9) }), false, NOW)).toMatchObject({
      word: 'Working',
      sentence: 'Working. Last sign of life 9 min ago.',
      action: null,
    })
  })

  it('is stuck once a claimed run is silent for 10 minutes', () => {
    expect(runHealth(run('claimed', { updatedAt: minutesAgo(10) }), false, NOW)).toEqual({
      word: 'Stuck',
      sentence: 'No sign of life for 10 min. The agent may have stopped.',
      action: null,
    })
  })

  it('is finished once submitted', () => {
    expect(runHealth(run('submitted'), false, NOW)).toMatchObject({ word: 'Finished', action: null })
  })

  it('says why a run failed and offers the ticket', () => {
    expect(runHealth(run('failed', { error: 'The build agent stopped.' }), false, NOW)).toEqual({
      word: 'Failed',
      sentence: 'The run failed: The build agent stopped.',
      action: 'ticket',
    })
  })

  it('calls an expired run failed and offers the ticket', () => {
    expect(runHealth(run('expired'), false, NOW)).toEqual({
      word: 'Failed',
      sentence: 'The run expired.',
      action: 'ticket',
    })
  })
})
