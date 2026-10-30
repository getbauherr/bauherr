import { describe, expect, it } from 'vitest'
import { frontierOrder, rankBetween } from '../src/lib/frontier'

describe('rankBetween', () => {
  it('starts in the middle and appends after the last key', () => {
    const a = rankBetween(null, null)
    expect(rankBetween(a, null) > a).toBe(true)
  })
  it('stays strictly between its bounds when bisecting repeatedly', () => {
    let [lo, hi] = ['0000001', '0000002'] as [string, string]
    for (let i = 0; i < 40; i++) {
      const m = rankBetween(lo, hi)
      expect(m > lo && m < hi).toBe(true)
      i % 2 ? (lo = m) : (hi = m)
    }
  })
  it('inserts before the first key and keeps appending', () => {
    expect(rankBetween(null, '000001') < '000001').toBe(true)
    let k = rankBetween(null, null)
    for (let i = 0; i < 200; i++) {
      const n = rankBetween(k, null)
      expect(n > k).toBe(true)
      k = n
    }
  })
  it('refuses out-of-order bounds', () => {
    expect(() => rankBetween('b', 'a')).toThrow('out of order')
    expect(() => rankBetween('a', 'a')).toThrow('out of order')
  })
})

describe('frontierOrder', () => {
  const t = (id: number, rank: string | null, extra: Record<string, unknown> = {}) => ({ id, number: id, rank, stage: 'build', ...extra })
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id)
  const run = (status: string, extra: Record<string, unknown> = {}) => ({ stage: 'build', status, ...extra })

  it('orders by rank, then number; unranked last', () => {
    expect(ids(frontierOrder([t(1, 'c'), t(2, 'a'), t(3, null), t(4, 'b'), t(5, 'a')], new Map()))).toEqual([2, 5, 4, 1, 3])
  })
  it('sorts uppercase before lowercase (byte order, not locale)', () => {
    expect(ids(frontierOrder([t(1, 'a'), t(2, 'B')], new Map()))).toEqual([2, 1])
  })
  it('puts in-flight work before ranked work', () => {
    const latest = new Map([
      [2, run('needs_human')],
      [3, run('awaiting_session', { previousRun: 9 })],
    ])
    const out = frontierOrder([t(1, 'a'), t(2, 'z'), t(3, 'y'), t(4, 'b', { stage: 'review' }), t(5, 'c', { stage: 'release' })], latest)
    expect(ids(out)).toEqual([4, 5, 3, 2, 1])
  })
  it('puts blocked and leased Tickets last', () => {
    const latest = new Map([[2, run('running', { mode: 'session' })]])
    expect(ids(frontierOrder([t(1, 'a', { blocked: true }), t(2, 'b'), t(3, 'c')], latest))).toEqual([3, 1, 2])
  })
})
