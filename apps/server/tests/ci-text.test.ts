import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ciLinkLabel, forgeLinkOf, waitingChip } from '../src/lib/ci-text'
import { ciSummaryOf } from '../src/lib/ci-summary'
import { ticketStatus } from '../src/app/(app)/lib/status'
import { DEFAULT } from '../src/lib/workflow'

const calls = vi.hoisted(() => ({ backendFor: vi.fn(), forgeOf: vi.fn() }))
vi.mock('../src/lib/adapters', () => ({ backendFor: calls.backendFor }))
vi.mock('../src/lib/release', async (orig) => ({ ...(await orig<typeof import('../src/lib/release')>()), forgeOf: calls.forgeOf }))

beforeEach(() => vi.clearAllMocks())

describe('forge link label', () => {
  it('is derived from the Connection kind and the number in the url', () => {
    expect(forgeLinkOf('github', 'https://github.com/acme/ci/pull/88')).toEqual({ href: 'https://github.com/acme/ci/pull/88', label: 'Open pull request #88 on GitHub' })
    expect(forgeLinkOf('gitlab', 'https://gitlab.com/g/p/-/merge_requests/88/')?.label).toBe('Open merge request !88 on GitLab')
  })
  it('falls back to "Open merge request" for an unknown kind or an url without a number', () => {
    expect(forgeLinkOf(undefined, 'https://x.test/mr/88')?.label).toBe('Open merge request')
    expect(forgeLinkOf('github', 'https://github.com/acme/ci/pulls')?.label).toBe('Open merge request')
  })
  it('is null for a malformed or non-web url instead of throwing', () => {
    for (const bad of [null, undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://x/1']) expect(forgeLinkOf('github', bad)).toBeNull()
  })
  it('names the CI checks link by forge', () => {
    expect([ciLinkLabel('github'), ciLinkLabel('gitlab'), ciLinkLabel(null)]).toEqual(['CI checks on GitHub', 'CI checks on GitLab', 'CI checks'])
    expect(waitingChip({ passed: 0, total: 2, pending: 1 })).toBe('Waiting for CI 1/2')
  })
})

describe('what the Ticket and Run page render from', () => {
  it('makes no forge call and builds no adapter', () => {
    const summary = { total: 2, passed: 0, pending: 1, failed: ['lint'], url: 'https://github.com/acme/ci/pull/88', updatedAt: '2026-11-16T10:00:00Z', rows: [] }
    expect(ciSummaryOf({ ciSummary: summary })?.summary.url).toBe(summary.url)
    expect(forgeLinkOf('github', summary.url)).not.toBeNull()
    ticketStatus(DEFAULT(), { open: true, stage: 'build', needsYou: null, blockedBy: [], queuedWhy: null, run: null, owner: null, forge: 'github', gate: null, track: { waitingFor: 'checks' }, ci: { passed: 0, total: 2, pending: 1 } })
    expect(calls.backendFor).not.toHaveBeenCalled()
    expect(calls.forgeOf).not.toHaveBeenCalled()
  })
})
