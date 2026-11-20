import { describe, expect, it } from 'vitest'
import { adoption, type AdoptablePull, type LinkedIssue } from '../../src/core/intake/adopt'

const pull = (extra: Partial<AdoptablePull> = {}): AdoptablePull => ({
  state: 'open',
  draft: false,
  gone: false,
  authorIsBot: false,
  authorTrusted: true,
  createdAt: '2026-05-01T00:00:00Z',
  connectedAt: '2026-06-01T00:00:00Z',
  headSha: 'abc1234',
  ...extra,
})

const issue = (extra: Partial<LinkedIssue> = {}): LinkedIssue => ({
  number: 7,
  state: 'open',
  gone: false,
  labels: [],
  hasRecord: false,
  ...extra,
})

const EXCLUDED = ['wontfix']

describe('adoption', () => {
  it('adopts an open pull request of a trusted author that closes one open issue, opened before connecting', () => {
    expect(adoption(pull(), [issue()], EXCLUDED)).toEqual({ adopt: true, issue: 7 })
  })

  it.each([
    ['closed', { state: 'closed' as const }],
    ['closed', { state: 'merged' as const }],
    ['draft', { draft: true }],
    ['gone', { gone: true }],
    ['no-head-commit', { headSha: '' }],
    ['bot', { authorIsBot: true }],
    ['outside-author', { authorTrusted: false }],
    ['opened-after-connect', { createdAt: '2026-06-02T00:00:00Z' }],
    ['opened-after-connect', { createdAt: '2026-06-01T00:00:00Z' }],
    ['opened-after-connect', { connectedAt: null }],
  ])('skips with reason %s', (reason, extra) => {
    expect(adoption(pull(extra), [issue()], EXCLUDED)).toEqual({ adopt: false, reason })
  })

  it('skips a pull request that names no open issue', () => {
    expect(adoption(pull(), [], EXCLUDED)).toEqual({ adopt: false, reason: 'no-open-issue' })
    expect(adoption(pull(), [issue({ state: 'closed' })], EXCLUDED)).toEqual({ adopt: false, reason: 'no-open-issue' })
    expect(adoption(pull(), [issue({ gone: true })], EXCLUDED)).toEqual({ adopt: false, reason: 'no-open-issue' })
  })

  it('skips a pull request that names several open issues, but counts only the open ones', () => {
    const two = [issue(), issue({ number: 8 })]
    expect(adoption(pull(), two, EXCLUDED)).toEqual({ adopt: false, reason: 'several-issues' })
    expect(adoption(pull(), [issue(), issue({ number: 8, state: 'closed' })], EXCLUDED)).toEqual({
      adopt: true,
      issue: 7,
    })
  })

  it('skips an issue with an excluded label and an issue that has a record', () => {
    expect(adoption(pull(), [issue({ labels: ['bug', 'wontfix'] })], EXCLUDED)).toEqual({
      adopt: false,
      reason: 'excluded-label',
    })
    expect(adoption(pull(), [issue({ hasRecord: true })], EXCLUDED)).toEqual({ adopt: false, reason: 'has-record' })
  })
})
