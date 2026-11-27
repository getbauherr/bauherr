import { describe, expect, it } from 'vitest'
import {
  defaultSelection,
  groupOf,
  listOf,
  mergeEntries,
  neighbour,
  INBOX_FIRST,
  INBOX_PAGE,
  nextWaiting,
  pagingOf,
  type InboxEntry,
} from '../../src/app/(app)/lib/inbox-entries'
import type { BoardCard } from '../../src/core/views/board'
import type { InboxChunk, InboxGroupId } from '../../src/core/views/inbox'

const card = (recordId: number, cardReason: string | null = null): BoardCard => ({
  recordId,
  number: recordId + 800,
  repo: 'acme/app',
  title: `Ticket ${recordId}`,
  product: { id: 1, name: 'App' },
  stage: 'brief',
  waitingOn: 'owner',
  state: 'owner',
  status: 'brief-needs-approval',
  detail: null,
  enteredAt: '2026-11-27T10:00:00.000Z',
  run: null,
  rank: 0,
  cardReason,
  parkedReason: null,
  closedAs: null,
  criteria: null,
  adopted: null,
  relations: null,
})

const chunk = (...cards: BoardCard[]): InboxChunk => ({ cards, total: cards.length, cursor: null })
const chunks = (parts: Partial<Record<InboxGroupId, BoardCard[]>>): Record<InboxGroupId, InboxChunk> => ({
  you: chunk(...(parts.you ?? [])),
  working: chunk(...(parts.working ?? [])),
  others: chunk(...(parts.others ?? [])),
  done: chunk(...(parts.done ?? [])),
})

const session = {
  id: 3,
  role: 'builder',
  label: 'Claude Code',
  keyLabel: 'k',
  connectedAt: '2026-11-27T09:00:00.000Z',
  lastSeenAt: '2026-11-27T09:59:00.000Z',
  state: 'working' as const,
  capacity: 1,
  tickets: [{ recordId: 11, number: 811 }],
}

describe('inbox list', () => {
  const entries = listOf({
    chunks: chunks({ you: [card(1), card(2, 'failed-runs'), card(3)], working: [card(11)], done: [card(20)] }),
    sessions: [session, { ...session, id: 4, state: 'closed' }],
    held: [],
  })

  it('groups waiting, failed, working, decided in that order', () => {
    expect(entries.map((e) => `${e.group}:${e.id}`)).toEqual([
      'waiting:1',
      'waiting:3',
      'failed:2',
      'working:11',
      'working:session-3',
      'decided:20',
    ])
  })

  it('selects the first waiting ticket by default and none when nothing waits', () => {
    expect(defaultSelection(entries)).toBe('1')
    expect(defaultSelection(entries.filter((e) => e.group !== 'waiting'))).toBeNull()
  })

  it('opens the next waiting ticket after a decision and wraps around', () => {
    expect(nextWaiting(entries, '1')).toBe('3')
    expect(nextWaiting(entries, '3')).toBe('1')
    expect(nextWaiting(entries.filter((e) => e.id !== '3'), '1')).toBeNull()
  })

  it('moves with j and k inside the list and stops at the ends', () => {
    expect(neighbour(entries, '1', 1)).toBe('3')
    expect(neighbour(entries, '1', -1)).toBe('1')
    expect(neighbour(entries, 'session-3', 1)).toBe('20')
    expect(neighbour(entries, '20', 1)).toBe('20')
  })

  it('skips held issues when moving and keeps their link', () => {
    const held: InboxEntry = { ...entries[0], id: 'held-9', kind: 'held', group: 'others', href: 'https://forge/9' }
    const all = mergeEntries(entries, [held])
    expect(neighbour(all, 'session-3', 1)).toBe('20')
    expect(all.find((e) => e.id === 'held-9')?.href).toBe('https://forge/9')
  })

  it('keeps loaded chunks in their group without duplicates', () => {
    const merged = mergeEntries(entries, [entries[5], { ...entries[5], id: '21' }])
    expect(merged.filter((e) => e.group === 'decided').map((e) => e.id)).toEqual(['20', '21'])
  })

  it('puts only failed runs under failed', () => {
    expect(groupOf(card(1, 'failed-runs'), 'you')).toBe('failed')
    expect(groupOf(card(1, 'verify-rounds'), 'you')).toBe('waiting')
    expect(groupOf(card(1), 'others')).toBe('others')
  })
})

describe('inbox paging', () => {
  const cursor = { updatedAt: '2026-11-27T10:00:00.000Z', id: 1 }
  const full = (count: number): InboxChunk => ({
    cards: Array.from({ length: count }, (_, i) => card(i + 1)),
    total: count + 10,
    cursor,
  })
  const of = (working: number, done: number) => ({ ...chunks({}), working: full(working), done: full(done) })

  it('offers Decided after its first 5 and the others after a full page', () => {
    expect(INBOX_FIRST.done).toBe(5)
    expect(pagingOf(of(5, 5)).done.cursor).toEqual(cursor)
    expect(pagingOf(of(5, 5)).working.cursor).toBeNull()
    expect(pagingOf(of(INBOX_PAGE, 4)).working.cursor).toEqual(cursor)
    expect(pagingOf(of(INBOX_PAGE, 4)).done.cursor).toBeNull()
  })
})
