import { describe, expect, it } from 'vitest'
import { hasSecondary } from '../src/app/(app)/lib/bar'

const base = { need: null, run: null, open: 0, product: 1, releaseRunUrl: null, canExpedite: false, answerable: 0 }

describe('the bar holds one secondary: the forge link only fits when none shows', () => {
  it('free: nothing to do, or only a primary', () => {
    expect(hasSecondary(base)).toBe(false)
    expect(hasSecondary({ ...base, need: 'Approve plan' })).toBe(false)
  })
  it('taken by Send back, Stop, the fast lane or Answer questions', () => {
    expect(hasSecondary({ ...base, need: 'Needs you' })).toBe(true)
    expect(hasSecondary({ ...base, need: 'Round cap reached' })).toBe(true)
    expect(hasSecondary({ ...base, canExpedite: true })).toBe(true)
    expect(hasSecondary({ ...base, answerable: 2 })).toBe(true)
  })
})
