import { describe, expect, it } from 'vitest'
import { relationsByRecord, type RelationEdge, type RelationItem } from '../../src/core/views/relations'

const item = (id: number, over: Partial<RelationItem> = {}): [number, RelationItem] => [
  id,
  { id, number: id + 100, title: `T${id}`, open: true, gone: false, stage: 'build', recordId: id + 1000, ...over },
]
const items = (...entries: [number, RelationItem][]) => new Map(entries)
const blocks = (from: number, to: number): RelationEdge => ({ from, to, type: 'blocks' })
const partOf = (from: number, to: number): RelationEdge => ({ from, to, type: 'part-of' })

describe('relationsByRecord', () => {
  it('counts every ticket further down the chain as blocked by the head', () => {
    const view = relationsByRecord([blocks(1, 2), blocks(2, 3)], items(item(1), item(2), item(3)))
    expect(view.get(1001)?.blocks.map((t) => t.number)).toEqual([102, 103])
    expect(view.get(1002)?.blocks.map((t) => t.number)).toEqual([103])
    expect(view.get(1003)?.blocks).toEqual([])
    expect(view.get(1003)?.blockedBy.map((t) => t.number)).toEqual([102])
  })

  it('does not count a closed blocker, nor go past a closed ticket in the chain', () => {
    const closed = items(item(1), item(2, { open: false, stage: null }), item(3))
    const view = relationsByRecord([blocks(1, 2), blocks(2, 3)], closed)
    expect(view.has(1001)).toBe(false)
    expect(view.has(1003)).toBe(false)
  })

  it('names the stage of each related ticket', () => {
    const view = relationsByRecord(
      [blocks(1, 2), blocks(1, 3), blocks(1, 4)],
      items(item(1), item(2, { stage: 'verify' }), item(3, { stage: null, recordId: null }), item(4, { open: false })),
    )
    expect(view.get(1001)?.blocks.map((t) => t.stage)).toEqual(['Verify', 'Not on the board'])
  })

  it('reports the parts done of a parent and gives each part its parent', () => {
    const view = relationsByRecord(
      [partOf(2, 1), partOf(3, 1), partOf(4, 1), partOf(5, 1)],
      items(item(1), item(2, { open: false }), item(3), item(4), item(5, { gone: true, open: false })),
    )
    expect(view.get(1001)?.parts).toMatchObject({ done: 1, total: 3 })
    expect(view.get(1003)?.parent).toMatchObject({ number: 101, parts: { done: 1, total: 3 } })
  })

  it('leaves tickets without relations out', () => {
    expect(relationsByRecord([], items(item(1))).size).toBe(0)
  })
})
