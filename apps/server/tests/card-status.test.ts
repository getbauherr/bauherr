import { describe, expect, it } from 'vitest'
import { cardStatus, showsProduct } from '../src/app/(app)/lib/card-status'

const run = (status: string, over = {}) => ({ id: 7, ticket: 1, stage: 'build', status, mode: 'scheduler', sessionOwner: null, heartbeatAt: '2026-01-01T00:00:00Z', startedAt: null, finishedAt: null, costUsd: null, createdAt: '2026-01-01T00:00:00Z', ...over })
const base = { run: null, owner: null, blockedBy: [], waiting: null }
const now = +new Date('2026-01-01T00:05:00Z')

describe('cardStatus', () => {
  it('is null without a live Run, blocker or wait', () => {
    expect(cardStatus({ ...base, run: run('succeeded') }, true)).toBeNull()
  })
  it('Working beats Blocked beats Waiting; the tip carries stage, who, heartbeat', () => {
    const all = { ...base, run: run('running'), blockedBy: [{ id: 1, number: 8 }], waiting: 'Waiting: Build is full (1/1)' }
    const s = cardStatus(all, true, now)!
    expect(s.status).toBe('Working')
    expect(s.tip).toBe('building · build Run #7 · scheduler · 5m ago')
    expect(cardStatus({ ...all, run: null }, true)!.status).toBe('Blocked')
    expect(cardStatus({ ...all, run: null, blockedBy: [] }, true)!.status).toBe('Waiting')
  })
  it('non-admins get the activity word only: no Run id, stage, login or heartbeat', () => {
    expect(cardStatus({ ...base, run: run('running'), owner: 'ada' }, false, now)!.tip).toBe('building')
  })
  it('a session Run names its owner to admins; awaiting_session is Working', () => {
    const s = cardStatus({ ...base, run: run('awaiting_session', { mode: 'session' }), owner: 'ada' }, true, now)!
    expect(s.status).toBe('Working')
    expect(s.tip).toContain('ada')
  })
  it('keeps ids out of the label and in the tip', () => {
    const s = cardStatus({ ...base, blockedBy: [{ id: 1, number: 8 }, { id: 2, number: 9 }] }, false)!
    expect(s.status).not.toMatch(/\d/)
    expect(s.tip).toBe('Blocked by #8, #9')
  })
})

describe('showsProduct', () => {
  it('needs at least one free slot in the budget of 3 (4 when it needs you)', () => {
    expect(showsProduct({ needsYou: null, parent: null }, false, true)).toBe(true)
    expect(showsProduct({ needsYou: null, parent: {} }, true, true)).toBe(false)
    expect(showsProduct({ needsYou: 'Review MR', parent: {} }, false, true)).toBe(true)
    expect(showsProduct({ needsYou: null, parent: null }, false, false)).toBe(false)
  })
})
