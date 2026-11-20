import { describe, expect, it } from 'vitest'
import { INTAKE_LABEL, select, type IntakeItem, type IntakeSettings } from '../../src/core/intake/select'

const item = (extra: Partial<IntakeItem> = {}): IntakeItem => ({
  kind: 'issue',
  state: 'open',
  gone: false,
  author: 'jo',
  authorTrusted: true,
  authorIsBot: false,
  labels: [],
  assignees: [],
  ...extra,
})

const settings: IntakeSettings = { excludedLabels: ['wontfix'], outsideIssuesPerDay: 2 }
const none = { admittedTodayByAuthor: {} }
const outsider = (extra: Partial<IntakeItem> = {}) => item({ authorTrusted: false, author: 'eve', ...extra })

describe('select', () => {
  it('enters an open issue of a trusted author', () => {
    expect(select(item(), settings, none)).toEqual({ action: 'enter', reason: 'trusted-author' })
  })

  it.each([
    ['not-an-issue', { kind: 'pr' as const }],
    ['closed', { state: 'closed' as const }],
    ['closed', { state: 'merged' as const }],
    ['gone', { gone: true }],
    ['bot', { authorIsBot: true }],
    ['assigned', { assignees: ['sam'] }],
    ['excluded-label', { labels: ['bug', 'wontfix'] }],
  ])('skips with reason %s', (reason, extra) => {
    expect(select(item(extra), settings, none)).toEqual({ action: 'skip', reason })
  })

  it('skips even when the intake label is set', () => {
    const labelled = outsider({ labels: [INTAKE_LABEL], assignees: ['sam'] })
    expect(select(labelled, settings, none).action).toBe('skip')
  })

  it('holds an outside author without the label', () => {
    expect(select(outsider(), settings, none)).toEqual({ action: 'hold', reason: 'outside-author' })
  })

  it('enters an outside author admitted by the label', () => {
    const labelled = outsider({ labels: [INTAKE_LABEL] })
    expect(select(labelled, settings, none)).toEqual({ action: 'enter', reason: 'intake-label' })
  })

  it('holds an admitted outside author over the daily budget, per author', () => {
    const labelled = outsider({ labels: [INTAKE_LABEL] })
    expect(select(labelled, settings, { admittedTodayByAuthor: { eve: 1 } }).action).toBe('enter')
    expect(select(labelled, settings, { admittedTodayByAuthor: { eve: 2 } })).toEqual({
      action: 'hold',
      reason: 'budget',
    })
    expect(select(labelled, settings, { admittedTodayByAuthor: { other: 9 } }).action).toBe('enter')
  })

  it('does not count the budget against a trusted author', () => {
    expect(select(item(), settings, { admittedTodayByAuthor: { jo: 99 } }).action).toBe('enter')
  })
})
