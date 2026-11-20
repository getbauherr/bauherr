import { describe, expect, it } from 'vitest'
import { rankChanges, type Ranked } from '../../src/core/views/reorder'

const stage = (...ranks: number[]): Ranked[] => ranks.map((rank, index) => ({ id: index + 1, rank }))

describe('rankChanges', () => {
  it('writes one rank between the new neighbours when there is room', () => {
    expect(rankChanges(stage(1, 2, 3), 3, 1)).toEqual([{ id: 3, rank: 1.5 }])
  })

  it('writes one rank before the first or after the last card', () => {
    expect(rankChanges(stage(1, 2, 3), 3, null)).toEqual([{ id: 3, rank: 0 }])
    expect(rankChanges(stage(1, 2, 3), 2, 3)).toEqual([{ id: 2, rank: 4 }])
    expect(rankChanges(stage(1, 2, 3), 1, 3)).toEqual([{ id: 1, rank: 4 }])
  })

  it('renumbers the stage when the neighbours have the same rank and writes one rank at the ends', () => {
    expect(rankChanges(stage(0, 0, 0), 3, 1)).toEqual([
      { id: 3, rank: 1 },
      { id: 2, rank: 2 },
    ])
    expect(rankChanges(stage(0, 0, 0), 3, null)).toEqual([{ id: 3, rank: -1 }])
  })

  it('renumbers when the gap between neighbours cannot be halved any more', () => {
    const next = 1 + Number.EPSILON
    expect(rankChanges(stage(1, next, 5), 3, 1)).toEqual([
      { id: 3, rank: 2 },
      { id: 2, rank: 3 },
    ])
  })

  it('changes nothing when the card is already there', () => {
    expect(rankChanges(stage(0, 0, 0), 2, 1)).toEqual([])
    expect(rankChanges(stage(0, 0, 0), 1, null)).toEqual([])
  })

  it('refuses a card or a neighbour that is not in the stage', () => {
    expect(rankChanges(stage(1, 2), 9, null)).toBeNull()
    expect(rankChanges(stage(1, 2), 1, 9)).toBeNull()
  })
})
