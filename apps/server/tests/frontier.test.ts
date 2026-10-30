import { describe, expect, it } from 'vitest'
import { NoRoom, frontierOrder, rankBetween } from '../src/lib/frontier'

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
  it('terminates when `hi` is `lo` plus trailing zeros: no key exists between them', () => {
    expect(() => rankBetween('00001', '000010')).toThrow('no rank between')
    expect(() => rankBetween('a', 'a000')).toThrow('no rank between')
    expect(rankBetween('00001', '000011') > '00001').toBe(true)
  })
  it('returns a key strictly between any pair, or throws NoRoom only when none exists', () => {
    const migration = Array.from({ length: 120 }, (_, i) => String(i + 1).padStart(6, '0'))
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n)
    const alphabet = '0019AZaz'
    const word = () => Array.from({ length: 1 + rnd(5) }, () => alphabet[rnd(alphabet.length)]).join('')
    const pairs: [string | null, string | null][] = [[null, null], [null, 'a'], ['z', null]]
    for (let i = 0; i < migration.length - 1; i++) pairs.push([migration[i], migration[i + 1]], [null, migration[i]], [migration[i], null])
    for (let i = 0; i < 2000; i++) pairs.push([rnd(4) ? word() : null, rnd(4) ? word() : null])
    let chained: [string, string] = [migration[0], migration[1]]
    for (let i = 0; i < 200; i++) {
      const m = rankBetween(...chained)
      pairs.push([chained[0], m], [m, chained[1]])
      chained = i % 3 ? [m, chained[1]] : [chained[0], m]
    }
    for (const [lo, hi] of pairs) {
      if (hi !== null && (lo ?? '') >= hi) continue
      let r: string
      try {
        r = rankBetween(lo, hi)
      } catch (e) {
        expect(e).toBeInstanceOf(NoRoom)
        expect(hi!.slice((lo ?? '').length)).toMatch(/^0+$/)
        expect(hi!.startsWith(lo ?? '')).toBe(true)
        continue
      }
      expect(r > (lo ?? ''), `${lo} < ${r}`).toBe(true)
      if (hi !== null) expect(r < hi, `${r} < ${hi}`).toBe(true)
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
  it('puts in-flight work (review, release, needs_human, sent back by review) before ranked work', () => {
    const latest = new Map([
      [2, run('needs_human')],
    ])
    const out = frontierOrder([t(1, 'a'), t(2, 'z'), t(3, 'y', { reviewRounds: 1 }), t(4, 'b', { stage: 'review' }), t(5, 'c', { stage: 'release' })], latest)
    expect(ids(out)).toEqual([4, 5, 3, 2, 1])
  })
  it('does not count reviewRounds outside the build stage', () => {
    expect(ids(frontierOrder([t(1, 'a'), t(2, 'b', { stage: 'plan', reviewRounds: 2 })], new Map()))).toEqual([1, 2])
  })
  it('puts blocked and leased Tickets last', () => {
    const latest = new Map([[2, run('running', { mode: 'session' })]])
    expect(ids(frontierOrder([t(1, 'a', { blocked: true }), t(2, 'b'), t(3, 'c')], latest))).toEqual([3, 1, 2])
  })
})
