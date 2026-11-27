import { describe, expect, it } from 'vitest'
import { autoAcceptedOf, NEEDS_OWNER_LABEL, type AutoAcceptFacts } from '../../src/core/auto-accept'
import { autoAcceptedText } from '../../src/core/views/labels'

const ELIGIBLE: AutoAcceptFacts = {
  maxSendBack: 10,
  door: 'two-way',
  criteria: { met: 4, total: 4 },
  dropped: 0,
  overridden: false,
  checks: 'passed',
  requiredChecks: 2,
  outsider: false,
  openPictures: 0,
  needsOwner: false,
  history: { done: 20, sentBack: 1 },
}

describe('the auto-accept rule', () => {
  it('accepts when every condition holds and keeps the inputs it used', () => {
    expect(autoAcceptedOf(ELIGIBLE)).toEqual({
      door: 'two-way',
      criteriaMet: 4,
      criteriaTotal: 4,
      checks: 'passed',
      sendBackPercent: 5,
      maxSendBackPercent: 10,
    })
  })

  it.each<[string, Partial<AutoAcceptFacts>]>([
    ['the change cannot be undone', { door: 'one-way' }],
    ['no required checks are known', { requiredChecks: 0 }],
    ['the ticket came from outside', { outsider: true }],
    ['the Brief names no risk', { door: null }],
    ['a criterion is not met', { criteria: { met: 3, total: 4 } }],
    ['there is no criterion', { criteria: { met: 0, total: 0 } }],
    ['the owner would have accepted an unmet criterion', { overridden: true }],
    ['a criterion was dropped', { dropped: 1 }],
    ['the checks failed', { checks: 'failed' }],
    ['the checks are pending', { checks: 'pending' }],
    ['no checks are required', { checks: 'none' }],
    ['a before and after picture is missing', { openPictures: 1 }],
    [`the ticket is labelled ${NEEDS_OWNER_LABEL}`, { needsOwner: true }],
    ['no ticket was accepted in the last 30 days', { history: { done: 0, sentBack: 0 } }],
    ['too many tickets were sent back', { history: { done: 20, sentBack: 3 } }],
    ['the history was not read', { history: null }],
  ])('does not accept when %s', (_name, change) => {
    expect(autoAcceptedOf({ ...ELIGIBLE, ...change })).toBeNull()
  })

  it('accepts exactly at the threshold and not above it', () => {
    const at = { ...ELIGIBLE, maxSendBack: 10, history: { done: 10, sentBack: 1 } }
    expect(autoAcceptedOf(at)?.sendBackPercent).toBe(10)
    expect(autoAcceptedOf({ ...at, history: { done: 10, sentBack: 2 } })).toBeNull()
    expect(autoAcceptedOf({ ...at, maxSendBack: 0, history: { done: 10, sentBack: 0 } })?.sendBackPercent).toBe(0)
    expect(autoAcceptedOf({ ...at, maxSendBack: 0 })).toBeNull()
  })

  it('words the reasons for the ticket and the Inbox', () => {
    const auto = autoAcceptedOf({ ...ELIGIBLE, history: { done: 50, sentBack: 3 } })
    expect(auto && autoAcceptedText(auto)).toBe('Accepted by the factory: two-way, 4/4 met, send-back 6 %')
  })
})
