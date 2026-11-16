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

describe('forgeLinkSpot', () => {
  it('the forge link always has a place: the free bar slot, else the CI panel, else Links', async () => {
    const { forgeLinkSpot } = await import('../src/app/(app)/lib/bar')
    expect(forgeLinkSpot({ need: null, ciPanel: false })).toBe('bar')
    expect(forgeLinkSpot({ need: 'Accept on staging', ciPanel: true })).toBe('panel')
    expect(forgeLinkSpot({ need: 'Accept on staging', ciPanel: false })).toBe('links')
    expect(forgeLinkSpot({ need: null, canExpedite: true, ciPanel: false })).toBe('links')
  })
})
