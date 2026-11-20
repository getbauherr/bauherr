import { describe, expect, it } from 'vitest'
import { STATUSES } from '../src/core/views/status'
import { isDimmed, workerOf } from '../src/app/(app)/lib/factory'
import { STATUS_WORDS } from '../src/app/(app)/lib/status-words'

describe('workerOf', () => {
  it('marks a Runner lease with R and any other lease with S and a short id', () => {
    expect(workerOf('runner-builder')).toEqual({ mark: 'R', name: 'Runner' })
    expect(workerOf('runner-verifier').mark).toBe('R')
    expect(workerOf('3f2a9c1e-77aa-4b1b-9d5e-000000000000')).toEqual({ mark: 'S', name: 'Session 3f2a9c1e' })
  })
})

describe('status words', () => {
  it('has a word for every status, and a queued run is neutral with a clock', () => {
    expect(Object.keys(STATUS_WORDS).sort()).toEqual([...STATUSES].sort())
    expect(STATUS_WORDS.queued).toEqual({ word: 'Queued', tone: 'neutral', mark: 'clock' })
  })
})

describe('isDimmed', () => {
  it('dims what the filter does not show and keeps stuck tickets under "you"', () => {
    expect(isDimmed('all', null)).toBe(false)
    expect(isDimmed('you', 'working')).toBe(true)
    expect(isDimmed('you', 'stuck')).toBe(false)
    expect(isDimmed('stuck', 'you')).toBe(true)
  })
})
