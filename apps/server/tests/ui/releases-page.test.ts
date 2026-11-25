import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PastVersions } from '../../src/app/(app)/components/releases/PastVersions'
import { ReleasesNow } from '../../src/app/(app)/components/releases/ReleasesNow'
import type { ReleasesView } from '../../src/core/releases/view'

class Watcher {
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', Watcher)

afterEach(cleanup)

const view: ReleasesView = {
  products: [],
  product: { id: 1, name: 'bauherr' },
  production: { sha: 'abc1234def', tag: 'v0.6.0', at: '2026-11-19T10:00:00.000Z', url: 'https://forge/v0.6.0' },
  staging: { sha: '7e7b712aaaa', checks: 'passing' },
  ready: null,
  past: [],
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
