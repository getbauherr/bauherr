import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReleaseControl } from '../../src/app/(app)/components/releases/ReleaseControl'
import { ReleasesUnread } from '../../src/app/(app)/components/releases/ReleasesCheck'
import { PastVersions } from '../../src/app/(app)/components/releases/PastVersions'
import { ReleasesNow } from '../../src/app/(app)/components/releases/ReleasesNow'
import { OPTIONS } from '../../src/core/releases/run-steps'
import type { ReleasePanel } from '../../src/core/releases/panel'
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

const actions = { release: async () => {}, answer: async () => {} }

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

  it('offers the proposed version with the commit, or the reason it is refused', () => {
    const panel: ReleasePanel = {
      proposal: { version: 'v0.7.0', bump: 'minor' },
      refusal: null,
      sha: '7e7b712aaaa',
      since: 'v0.6.0',
      changes: 14,
      run: null,
    }
    const { rerender } = render(createElement(ReleaseControl, { panel, product: 1, refused: null, actions }))
    expect(screen.getByDisplayValue('v0.7.0')).toBeTruthy()
    expect(screen.getByText('7e7b712')).toBeTruthy()
    expect(screen.getByText('minor: new capabilities, nothing breaks')).toBeTruthy()
    expect(screen.getByText(/Covers 14 changes merged since/)).toBeTruthy()
    expect(screen.getByText('v0.6.0')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Release v0.7.0' })
    expect(button.hasAttribute('disabled')).toBe(false)
    const refused = { ...panel, refusal: 'Nothing was merged since the last version.' }
    rerender(createElement(ReleaseControl, { panel: refused, product: 1, refused: null, actions }))
    expect(screen.getByText('Nothing was merged since the last version.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Release v0.7.0' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows each step with its forge link and a question when a step failed', () => {
    const [done, started] = ['Tag v0.7.0 created', 'Production deploy started'].map((label, at) => ({
      id: `step-${at}`,
      label,
      status: 'done' as const,
      link: `https://forge/${at}`,
    }))
    const stopped = { id: 'wait', label: 'Waiting for production', status: 'failed' as const, link: null }
    const question = { text: 'Releasing v0.7.0 stopped: The production deploy failed.', options: OPTIONS }
    const run = { id: 3, version: 'v0.7.0', state: 'failed' as const, steps: [done, started, stopped], question }
    const panel: ReleasePanel = {
      proposal: { version: 'v0.8.0', bump: 'minor' },
      refusal: 'Releasing v0.7.0 is not finished yet.',
      sha: 'abc',
      since: 'v0.6.0',
      changes: 3,
      run,
    }
    render(createElement(ReleaseControl, { panel, product: 1, refused: null, actions }))
    expect(screen.getByText('Release v0.7.0 stopped')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /On the forge/ }).map((a) => a.getAttribute('href'))).toEqual([
      'https://forge/0',
      'https://forge/1',
    ])
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Release a fixed version later' })).toBeTruthy()
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
