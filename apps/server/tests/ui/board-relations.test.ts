import { describe, expect, it } from 'vitest'
import { groupsByParent, parseView } from '../../src/app/(app)/lib/board-relations'

const parent = { number: 7, title: 'Epic', stage: 'Brief', recordId: 7, parts: { done: 1, total: 2, tickets: [] } }
const related = { blocks: [], blockedBy: [], parts: null, parent }
const card = (recordId: number, withParent: boolean) => ({ recordId, relations: withParent ? related : null })

describe('board relations view', () => {
  it('reads the filter and the grouping from the address', () => {
    expect(parseView({ relation: 'blocked', group: 'parent' })).toEqual({ relation: 'blocked', group: true })
    expect(parseView({ relation: 'nonsense', group: 'x' })).toEqual({ relation: undefined, group: false })
  })

  it('puts tickets without a parent in a last band', () => {
    const groups = groupsByParent([card(1, true), card(2, false), card(3, true)])
    expect(groups.map((g) => [g.key, g.cards.map((c) => c.recordId)])).toEqual([
      ['parent-7', [1, 3]],
      ['no-parent', [2]],
    ])
  })
})
