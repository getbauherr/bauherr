import { describe, expect, it } from 'vitest'
import { renderStatus } from '../../src/core/forge/status'
import { briefed, criterion } from './fixtures'

describe('renderStatus', () => {
  it('names the goal, marks the current stage, counts met criteria and shows the pull request', () => {
    const record = briefed({ criteria: [criterion(1, { status: 'met' }), criterion(2), criterion(3)] })
    const text = renderStatus({ record, stage: 'verify', pr: 12, changedAt: '2026-11-19T10:00:00.000Z' })
    expect(text).toContain('**Goal:** Fix the thing')
    expect(text).toContain('intake › brief › build › **verify** › ship › done')
    expect(text).toContain('**Criteria:** 1 of 3 met')
    expect(text).toContain('**Pull request:** #12')
    expect(text).toContain('**Last change:** 2026-11-19T10:00:00.000Z')
  })

  it('says what is not there yet', () => {
    const record = briefed({ goal: '', criteria: [] })
    const text = renderStatus({ record, stage: 'build', pr: null, changedAt: null })
    expect(text).toContain('not written yet')
    expect(text).toContain('**Criteria:** 0 of 0 met')
    expect(text).toContain('**Pull request:** none yet')
  })

  it('renders the same record the same way', () => {
    const input = { record: briefed(), stage: 'build' as const, pr: null, changedAt: null }
    expect(renderStatus(input)).toBe(renderStatus(input))
  })
})
