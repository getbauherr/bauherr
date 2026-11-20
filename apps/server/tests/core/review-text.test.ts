import { describe, expect, it } from 'vitest'
import { reviewText } from '../../src/core/forge/review-text'
import { criterion } from './fixtures'

const finding = (id: string, status: 'open' | 'fixed') => ({
  id,
  axis: 'spec' as const,
  text: `finding ${id}`,
  evidence: { kind: 'test' as const, pointer: `tests/${id}.test.ts` },
  status,
})

describe('reviewText', () => {
  it('names the commit and gives one line per open finding with its evidence pointer', () => {
    const text = reviewText('abcdef1234', [finding('f1', 'open'), finding('f2', 'fixed'), finding('f3', 'open')], [])
    expect(text).toBe(
      [
        'Verification of abcdef1 asks for changes:',
        '- finding f1 (test: tests/f1.test.ts)',
        '- finding f3 (test: tests/f3.test.ts)',
      ].join('\n'),
    )
  })

  it('lists the open findings first, then the criteria that are not met', () => {
    const criteria = [criterion(1, { status: 'met' }), criterion(2, { status: 'partial' }), criterion(3)]
    expect(reviewText('abcdef1234', [finding('f1', 'open')], criteria)).toBe(
      [
        'Verification of abcdef1 asks for changes:',
        '- finding f1 (test: tests/f1.test.ts)',
        '- criterion 2 (partial)',
        '- criterion 3 (open)',
      ].join('\n'),
    )
  })

  it('lists the unmet criteria when there is no open finding', () => {
    const text = reviewText('abcdef1234', [], [criterion(1, { status: 'met' }), criterion(2, { status: 'missing' })])
    expect(text).toBe('Verification of abcdef1 asks for changes:\n- criterion 2 (missing)')
  })
})
