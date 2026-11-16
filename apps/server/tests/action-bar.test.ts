import { describe, expect, it } from 'vitest'
import { hasSecondary } from '../src/app/(app)/lib/bar'

const base = { need: null, canExpedite: false }

describe('the bar holds one secondary: the forge link only fits when none shows', () => {
  it('free: nothing to do, or only a primary', () => {
    expect(hasSecondary(base)).toBe(false)
    expect(hasSecondary({ ...base, need: 'Approve plan' })).toBe(false)
  })
  it('taken by Send back, Stop, or the fast lane', () => {
    expect(hasSecondary({ ...base, need: 'Needs you' })).toBe(true)
    expect(hasSecondary({ ...base, need: 'Round cap reached' })).toBe(true)
    expect(hasSecondary({ ...base, canExpedite: true })).toBe(true)
  })
})
