import { describe, expect, it } from 'vitest'
import { type Epic, epicHue, epicNamed, epicProgress, epicRestoreUrl, epicWhere, epicShortTitle, epicsToShow, inEpic } from '../src/app/(app)/lib/epics'
import { DEFAULT } from '../src/lib/workflow'

const child = (id: number, stage: Epic['children'][0]['stage'], open: boolean) => ({ id, number: id, title: `c${id}`, stage, open, status: '' })
const epic = (id: number, rank: string | null, open = true, product: number | null = 1, children: Epic['children'] = []): Epic => ({ id, number: id, title: `e${id}`, open, rank, product, children })

describe('epics', () => {
  it('counts done and open sub-tickets per Board column', () => {
    const p = epicProgress(DEFAULT(), epic(1, null, true, 1, [child(2, 'build', true), child(3, 'build', true), child(4, 'plan', true), child(5, 'done', false)]))
    expect(p).toEqual({ done: 1, total: 4, stages: [{ stage: 'plan', count: 1 }, { stage: 'build', count: 2 }] })
  })
  it('lists open epics in rank order; done ones only on request; product narrows', () => {
    const all = [epic(1, 'b'), epic(2, 'a'), epic(3, 'a', false), epic(4, 'c', true, 2)]
    expect(epicsToShow(all, false, null).map((e) => e.id)).toEqual([2, 1, 4])
    expect(epicsToShow(all, true, null).map((e) => e.id)).toEqual([2, 3, 1, 4])
    expect(epicsToShow(all, false, 2).map((e) => e.id)).toEqual([4])
  })
  it('filters rows to one epic, or keeps all', () => {
    const rows = [{ id: 1, parent: { id: 9 } }, { id: 2, parent: { id: 8 } }, { id: 3, parent: null }]
    expect(inEpic(rows, 9).map((r) => r.id)).toEqual([1])
    expect(inEpic(rows, null)).toHaveLength(3)
  })
  it('gives a stable hue and a short title', () => {
    expect(epicHue(7)).toBe(epicHue(7))
    expect(epicHue(1)).not.toBe(epicHue(2))
    expect(epicShortTitle('Overhaul invoicing')).toBe('Overhaul invoicing')
    expect(epicShortTitle('A very long epic title indeed')).toHaveLength(18)
  })
  it('finds epics structurally: stage parent or any Ticket with sub-tickets', () => {
    expect(epicWhere(DEFAULT(), [])).toEqual({ or: [{ stage: { equals: 'parent' } }] })
    expect(epicWhere(DEFAULT(), [7, 9])).toEqual({ or: [{ stage: { equals: 'parent' } }, { id: { in: [7, 9] } }] })
  })
  it('reads the epic a request names: nothing, All or unknown, or an epic', () => {
    expect(epicNamed(undefined, [{ id: 4 }])).toBeUndefined()
    expect(epicNamed('', [{ id: 4 }])).toBeNull()
    expect(epicNamed('9', [{ id: 4 }])).toBeNull()
    expect(epicNamed('4', [{ id: 4 }])).toBe(4)
  })
  it('restores a remembered epic only when none is named and it is still open', () => {
    const epics = [{ id: 4, open: true }, { id: 6, open: false }]
    expect(epicRestoreUrl('/', { state: 'all' }, 4, epics)).toBe('/?state=all&epic=4')
    expect(epicRestoreUrl('/runs', {}, 4, epics)).toBe('/runs?epic=4')
    expect(epicRestoreUrl('/', { epic: '9' }, 4, epics)).toBeNull()
    expect(epicRestoreUrl('/', { epic: '' }, 4, epics)).toBeNull()
    expect(epicRestoreUrl('/', {}, 5, epics)).toBeNull()
    expect(epicRestoreUrl('/', {}, null, epics)).toBeNull()
    expect(epicRestoreUrl('/', {}, 6, epics)).toBeNull()
  })
})
