import type { Check, Comment, PullRequest, Ticket } from '@bauherr/adapters'
import { describe, expect, it } from 'vitest'
import {
  checkRow,
  commentRow,
  errorText,
  isDue,
  itemFromPull,
  itemFromTicket,
  laterOf,
  lookbackFrom,
  takeBatch,
} from '../../src/core/mirror/map'

const ticket: Ticket = {
  id: '7',
  number: 7,
  url: 'https://forge/o/r/issues/7',
  title: 'Crash on save',
  state: 'closed',
  labels: ['bug'],
  assignee: 'ana',
  assignees: ['ana'],
  updatedAt: '2026-11-02T10:00:00Z',
  createdAt: '2026-11-01T10:00:00Z',
  closedAt: '2026-11-02T09:00:00Z',
  author: 'jo',
  authorTrusted: true,
  authorIsBot: false,
  body: 'It crashes.',
  parent: null,
  blockedBy: [],
  links: [],
}

const pull: PullRequest = {
  number: 9,
  url: 'https://forge/o/r/pull/9',
  title: 'Fix the crash',
  body: 'Fixes #7',
  state: 'merged',
  head: 'fix-7',
  base: 'main',
  headSha: 'abc',
  headRepo: 'o/r',
  baseRepo: 'o/r',
  draft: false,
  author: 'bot',
  authorTrusted: false,
  authorIsBot: true,
  createdAt: '2026-11-03T10:00:00Z',
  updatedAt: '2026-11-03T11:00:00Z',
  labels: [],
  assignees: [],
  closes: [7],
}

describe('itemFromTicket', () => {
  it('maps an issue and leaves the pull request columns empty', () => {
    expect(itemFromTicket(ticket)).toEqual({
      kind: 'issue',
      number: 7,
      title: 'Crash on save',
      body: 'It crashes.',
      state: 'closed',
      author: 'jo',
      authorTrusted: true,
      authorIsBot: false,
      labels: ['bug'],
      assignees: ['ana'],
      url: 'https://forge/o/r/issues/7',
      forgeCreatedAt: '2026-11-01T10:00:00Z',
      forgeUpdatedAt: '2026-11-02T10:00:00Z',
      forgeClosedAt: '2026-11-02T09:00:00Z',
      headSha: null,
      headRef: null,
      closes: [],
      draft: false,
    })
  })

  it('maps a missing closing time to null', () => {
    const { closedAt, ...open } = ticket
    expect(closedAt).toBeDefined()
    expect(itemFromTicket({ ...open, state: 'open' })).toMatchObject({ state: 'open', forgeClosedAt: null })
  })
})

describe('itemFromPull', () => {
  it('maps head, closing issues, draft and the merged state', () => {
    expect(itemFromPull(pull)).toMatchObject({
      kind: 'pr',
      number: 9,
      state: 'merged',
      author: 'bot',
      authorIsBot: true,
      headSha: 'abc',
      headRef: 'fix-7',
      closes: [7],
      draft: false,
      forgeClosedAt: null,
    })
  })
})

describe('commentRow and checkRow', () => {
  it('maps a comment', () => {
    const comment: Comment = { id: '5', author: 'jo', body: 'hi', createdAt: 'a', updatedAt: 'b' }
    expect(commentRow(comment)).toEqual({
      forgeId: '5',
      author: 'jo',
      body: 'hi',
      forgeCreatedAt: 'a',
      forgeUpdatedAt: 'b',
    })
  })

  it('maps a check with and without the optional fields', () => {
    const full: Check = { name: 'ci', status: 'completed', conclusion: 'success', url: 'u', startedAt: 's' }
    expect(checkRow('abc', full)).toEqual({
      sha: 'abc',
      name: 'ci',
      status: 'completed',
      conclusion: 'success',
      url: 'u',
      forgeUpdatedAt: 's',
    })
    expect(checkRow('abc', { name: 'ci', status: 'in_progress', conclusion: null })).toMatchObject({
      conclusion: null,
      url: null,
      forgeUpdatedAt: null,
    })
  })
})

describe('takeBatch', () => {
  const at = (n: number) => ({ id: n, updatedAt: `2026-11-01T10:00:${String(n).padStart(2, '0')}Z` })

  it('keeps a short list whole', () => {
    expect(takeBatch([at(1), at(2)], 3)).toEqual({ batch: [at(1), at(2)], truncated: false })
  })

  it('cuts a long list at the limit', () => {
    const list = [1, 2, 3, 4, 5].map(at)
    expect(takeBatch(list, 3)).toEqual({ batch: list.slice(0, 3), truncated: true })
  })

  it('does not split items that share the last timestamp', () => {
    const list = [at(1), at(2), { id: 3, updatedAt: at(2).updatedAt }, { id: 4, updatedAt: at(2).updatedAt }, at(5)]
    expect(takeBatch(list, 2).batch.map((i) => i.id)).toEqual([1, 2, 3, 4])
    expect(takeBatch(list, 2).truncated).toBe(true)
  })

  it('is not truncated when the tie runs to the end of the list', () => {
    const list = [at(1), at(2), { id: 3, updatedAt: at(2).updatedAt }]
    expect(takeBatch(list, 2)).toEqual({ batch: list, truncated: false })
  })
})

describe('time helpers', () => {
  it('goes back the given hours from the cursor', () => {
    expect(lookbackFrom('2026-11-02T10:00:00Z', 6)).toBe('2026-11-02T04:00:00.000Z')
  })

  it('is due when never done or when the interval has passed', () => {
    const now = new Date('2026-11-02T10:00:00Z')
    expect(isDue(null, now, 3_600_000)).toBe(true)
    expect(isDue('2026-11-02T09:00:00Z', now, 3_600_000)).toBe(true)
    expect(isDue('2026-11-02T09:00:01Z', now, 3_600_000)).toBe(false)
  })

  it('picks the later of two instants and tolerates null', () => {
    expect(laterOf('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z')).toBe('2026-11-02T11:00:00Z')
    expect(laterOf('2026-11-02T12:00:00Z', '2026-11-02T11:00:00Z')).toBe('2026-11-02T12:00:00Z')
    expect(laterOf(null, '2026-11-02T11:00:00Z')).toBe('2026-11-02T11:00:00Z')
    expect(laterOf(null, null)).toBeNull()
  })

  it('shortens an error text', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText('plain')).toBe('plain')
    expect(errorText(new Error('x'.repeat(2000)))).toHaveLength(1000)
  })
})
