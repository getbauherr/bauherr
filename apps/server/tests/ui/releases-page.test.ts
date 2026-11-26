import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReleasesUnread } from '../../src/app/(app)/components/releases/ReleasesCheck'
import { PastVersions } from '../../src/app/(app)/components/releases/PastVersions'
import { ReleasesNow } from '../../src/app/(app)/components/releases/ReleasesNow'
import type { ReleasesView } from '../../src/core/releases/view'

class Watcher {
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', Watcher)
vi.mock('../../src/app/(app)/(shell)/settings/products/[id]/actions', () => ({
  checkReadinessNow: async () => ({}),
  makeReadinessTicket: async () => ({}),
  saveReadinessFix: async () => ({}),
}))

afterEach(cleanup)

const view: ReleasesView = {
  products: [],
  product: { id: 1, name: 'bauherr' },
  production: { sha: 'abc1234def', tag: 'v0.6.0', at: '2026-11-19T10:00:00.000Z', url: 'https://forge/v0.6.0' },
  staging: { sha: '7e7b712aaaa', checks: 'passing' },
  ready: null,
  past: [],
  notes: null,
  check: null,
}

describe('releases page parts', () => {
  it('says what runs on production since when and the staging commit with its checks', () => {
    render(createElement(ReleasesNow, { view }))
    expect(screen.getByText('v0.6.0')).toBeTruthy()
    expect(screen.getByText(/on production since 19 Nov/)).toBeTruthy()
    expect(screen.getByText('7e7b712')).toBeTruthy()
    expect(screen.getByText('on staging · checks green')).toBeTruthy()
  })

  it('links the notes only for a version that has notes', () => {
    const past = [
      { tag: 'v0.6.0', at: '2026-11-19T10:00:00.000Z', changes: 14, notes: 'Notes', url: 'https://forge/v0.6.0' },
      { tag: 'v0.5.0', at: '2026-11-17T10:00:00.000Z', changes: 9, notes: null, url: 'https://forge/v0.5.0' },
    ]
    render(createElement(PastVersions, { past }))
    const [first, second] = screen.getAllByRole('row').slice(1)
    if (!first || !second) throw new Error('two rows expected')
    expect(within(first).getByRole('link', { name: 'Read' })).toBeTruthy()
    expect(within(first).getByText('19 Nov')).toBeTruthy()
    expect(within(first).getByText('14')).toBeTruthy()
    expect(within(second).queryByRole('link', { name: 'Read' })).toBeNull()
    expect(within(second).getByRole('link', { name: 'Release on the forge' })).toBeTruthy()
  })
})

describe('releases page without facts', () => {
  const failed = { at: '2026-11-26T08:00:00.000Z', error: 'Bad credentials' }

  it('shows the error and the Check now button to an Admin', () => {
    render(createElement(ReleasesUnread, { check: failed, product: 1, canCheck: true }))
    expect(screen.getByRole('alert').textContent).toContain('Bad credentials')
    expect(screen.getByRole('button', { name: 'Check now' })).toBeTruthy()
  })

  it('says it never ran and offers no button to a member who cannot change settings', () => {
    render(createElement(ReleasesUnread, { check: null, product: 1, canCheck: false }))
    expect(screen.getByText('The readiness check has not run for this Product.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a checked time and no error line after a good check', () => {
    render(createElement(ReleasesUnread, { check: { at: failed.at, error: null }, product: 1, canCheck: false }))
    expect(screen.getByText(/Last readiness check/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
