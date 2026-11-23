import { describe, expect, it } from 'vitest'
import {
  checkOf,
  mayMakeCheck,
  preventionBody,
  preventionTitle,
  referenceOf,
  PREVENTION_ASK,
  type Prevention,
} from '../../src/core/memory-check'

const base: Prevention = {
  scope: 'product',
  off: false,
  cameBack: 0,
  issue: null,
  record: null,
  accepted: false,
  endedAt: null,
}
const at = '2026-11-24T09:00:00.000Z'

describe('the check state of a memory', () => {
  it('wants a check from three tickets on, and not before', () => {
    expect(checkOf({ ...base, cameBack: 2 })).toEqual({ kind: 'none' })
    expect(checkOf({ ...base, cameBack: 3 })).toEqual({ kind: 'wants' })
    expect(checkOf({ ...base, cameBack: 5 })).toEqual({ kind: 'wants' })
  })

  it('never flags a memory of one ticket or a switched off one', () => {
    expect(checkOf({ ...base, cameBack: 4, scope: 'ticket' })).toEqual({ kind: 'none' })
    expect(checkOf({ ...base, cameBack: 4, off: true })).toEqual({ kind: 'none' })
  })

  it('is being built while the prevention ticket is open, with or without a record yet', () => {
    expect(checkOf({ ...base, cameBack: 3, issue: 9 })).toEqual({ kind: 'building', issue: 9, record: null })
    expect(checkOf({ ...base, issue: 9, record: 4 })).toEqual({ kind: 'building', issue: 9, record: 4 })
  })

  it('is done once the prevention ticket was accepted', () => {
    expect(checkOf({ ...base, issue: 9, record: 4, accepted: true })).toEqual({ kind: 'since', issue: 9, record: 4 })
  })

  it('is discarded, and never flagged again, once the prevention ticket ended without acceptance', () => {
    const ended = { ...base, cameBack: 6, issue: 9, record: 4, endedAt: at }
    expect(checkOf(ended)).toEqual({ kind: 'discarded', issue: 9, record: 4, at })
  })
})

describe('who may make a check', () => {
  it('allows an active memory of the Product that is new, flagged or discarded', () => {
    expect(mayMakeCheck(base)).toBe(true)
    expect(mayMakeCheck({ ...base, cameBack: 3 })).toBe(true)
    expect(mayMakeCheck({ ...base, issue: 9, record: 4, endedAt: at })).toBe(true)
  })

  it('refuses a ticket memory, a switched off one, one being built and one that is done', () => {
    expect(mayMakeCheck({ ...base, scope: 'ticket' })).toBe(false)
    expect(mayMakeCheck({ ...base, off: true })).toBe(false)
    expect(mayMakeCheck({ ...base, issue: 9 })).toBe(false)
    expect(mayMakeCheck({ ...base, issue: 9, accepted: true })).toBe(false)
  })
})

describe('the prevention issue', () => {
  it('cuts the title at 80 characters', () => {
    expect(preventionTitle('Short rule.')).toBe('Prevent by a check: Short rule.')
    const long = 'x'.repeat(81)
    expect(preventionTitle(long)).toBe(`Prevent by a check: ${'x'.repeat(80)}…`)
    expect(preventionTitle('x'.repeat(80))).toBe(`Prevent by a check: ${'x'.repeat(80)}`)
  })

  it('names the memory, its source as data, the tickets it came back on as links, and the ask', () => {
    const body = preventionBody({
      text: 'A forge answer that says "not in your plan" is an empty answer.',
      origin: {
        from: 'Reviewer finding',
        text: 'Sync failed with 403.',
        ticket: { number: 763, title: 'Rules on a free repo', url: 'https://forge.test/acme/r/issues/763' },
      },
      cameBack: [
        { number: 774, title: 'Required checks', url: 'https://forge.test/acme/r/issues/774' },
        { number: 790, title: null, url: null },
      ],
    })
    expect(body.startsWith('A forge answer that says "not in your plan" is an empty answer.')).toBe(true)
    expect(body).toContain('Reviewer finding, [#763 Rules on a free repo](https://forge.test/acme/r/issues/763)')
    expect(body).toContain('```text\nSync failed with 403.\n```')
    expect(body).toContain('- [#774 Required checks](https://forge.test/acme/r/issues/774)\n- #790')
    expect(body.endsWith(PREVENTION_ASK)).toBe(true)
  })

  it('leaves out the source text when the memory was written by hand', () => {
    const origin = { from: 'You wrote it', text: null, ticket: null }
    const body = preventionBody({ text: 'Rule.', origin, cameBack: [] })
    expect(body).toContain('## Where it came from\n\nYou wrote it\n\n## It came back on')
    expect(body).not.toContain('```')
  })

  it('keeps the reference of a retry and changes it after a discarded check', () => {
    expect(referenceOf(12, null)).toBe('bauherr-memory-12')
    expect(referenceOf(12, 9)).toBe('bauherr-memory-12-after-9')
  })
})
