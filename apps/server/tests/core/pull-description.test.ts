import { describe, expect, it } from 'vitest'
import { pullDescription, pullTitle } from '../../src/core/forge/pull-description'
import { emptyRecord } from '../../src/core/record/schema'
import { criterion, source } from './fixtures'

const record = {
  ...emptyRecord(source, 'bug'),
  goal: 'Show the rows',
  criteria: [criterion(1), criterion(2)],
  outOfScope: ['export'],
}

describe('pullDescription', () => {
  it('renders the goal, the criteria, what is out of scope and the closing line', () => {
    expect(pullDescription(record)).toBe(
      [
        '## Goal',
        'Show the rows',
        '',
        '## Acceptance criteria',
        '- criterion 1',
        '- criterion 2',
        '',
        '## Out of scope',
        '- export',
        '',
        'Closes #7',
      ].join('\n'),
    )
  })

  it('leaves out an empty list and titles the pull request with the goal', () => {
    const plain = { ...record, criteria: [], outOfScope: [] }
    expect(pullDescription(plain)).toBe('## Goal\nShow the rows\n\nCloses #7')
    expect(pullTitle(record)).toBe('Show the rows')
    expect(pullTitle({ ...record, goal: '' })).toBe('Fix #7')
  })
})
