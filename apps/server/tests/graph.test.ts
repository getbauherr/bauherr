import { describe, expect, it } from 'vitest'
import { layoutGraph, type GraphTicket } from '../src/app/(app)/lib/graph'

const t = (number: number, blockedBy: number[] = [], extra: Partial<GraphTicket> = {}): GraphTicket => ({ id: number, number, stage: 'build', run: null, blockedBy: blockedBy.map((id) => ({ id })), ...extra })
const node = (g: ReturnType<typeof layoutGraph>, id: number) => g.nodes.find((n) => n.id === id)!
const crit = (g: ReturnType<typeof layoutGraph>) => g.nodes.filter((n) => n.critical).map((n) => n.id)

describe('layoutGraph', () => {
  it('lays a chain out in consecutive columns and marks all of it critical', () => {
    const g = layoutGraph([t(3, [2]), t(2, [1]), t(1)])
    expect([1, 2, 3].map((i) => node(g, i).col)).toEqual([0, 1, 2])
    expect(crit(g)).toEqual([1, 2, 3])
    expect(g.edges).toEqual(expect.arrayContaining([{ from: 1, to: 2, critical: true }, { from: 2, to: 3, critical: true }]))
  })
  it('puts a diamond join after its longest blocker chain', () => {
    const g = layoutGraph([t(1), t(2, [1]), t(3, [1]), t(4, [2, 3])])
    expect(node(g, 4).col).toBe(2)
    expect([2, 3].map((i) => node(g, i).row)).toEqual([0, 1])
    expect(crit(g)).toEqual([1, 2, 4])
    expect(g.edges).toHaveLength(4)
    expect(g.edges.filter((e) => e.critical).map((e) => `${e.from}>${e.to}`).sort()).toEqual(['1>2', '2>4'])
  })
  it('takes the longer of two chains as critical', () => {
    const g = layoutGraph([t(1), t(2, [1]), t(3, [2]), t(10), t(11, [10])])
    expect(crit(g)).toEqual([1, 2, 3])
    expect(node(g, 11).critical).toBe(false)
  })
  it('collapses Tickets without edges and marks nothing critical for them', () => {
    const g = layoutGraph([t(1), t(2), t(3, [1])])
    expect(node(g, 2).isolated).toBe(true)
    expect(node(g, 1).isolated).toBe(false)
    expect(layoutGraph([t(1)]).nodes[0]).toMatchObject({ isolated: true, critical: false })
  })
  it('ignores blockers that are not shown but keeps the Ticket not ready', () => {
    const g = layoutGraph([t(2, [99])])
    expect(g.edges).toEqual([])
    expect(node(g, 2)).toMatchObject({ isolated: true, ready: false })
  })
  it('breaks cycles and flags them', () => {
    const g = layoutGraph([t(1, [2]), t(2, [1])])
    expect(g.cycle).toBe(true)
    expect(g.edges).toHaveLength(1)
    expect(layoutGraph([t(1), t(2, [1])]).cycle).toBe(false)
  })
  it('is ready only without open blockers, lease or done stage', () => {
    const g = layoutGraph([t(1), t(2, [1]), t(3, [], { run: { status: 'running' } }), t(4, [], { stage: 'done' }), t(5, [], { run: { status: 'failed' } })])
    expect([1, 2, 3, 4, 5].map((i) => node(g, i).ready)).toEqual([true, false, false, false, true])
  })
})
