import { describe, expect, it } from 'vitest'
import { type Epic, epicHue, epicProgress, epicShortTitle, epicsToShow, inEpic, plainStatus } from '../src/app/(app)/lib/epics'

const child = (id: number, stage: Epic['children'][0]['stage'], open: boolean) => ({ id, number: id, title: `c${id}`, stage, open, status: '' })
const epic = (id: number, rank: string | null, open = true, product: number | null = 1, children: Epic['children'] = []): Epic => ({ id, number: id, title: `e${id}`, open, rank, product, children })

describe('epics', () => {
  it('counts done and open sub-tickets per Board column', () => {
    const p = epicProgress(epic(1, null, true, 1, [child(2, 'build', true), child(3, 'build', true), child(4, 'plan', true), child(5, 'done', false)]))
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
  it('says status in plain words', () => {
    const t = { open: true, needsYou: null, blockedBy: [], waiting: null, run: null }
    expect(plainStatus({ ...t, open: false })).toBe('Done')
    expect(plainStatus({ ...t, needsYou: 'Approve plan' })).toBe('Needs you')
    expect(plainStatus({ ...t, run: { status: 'running' } })).toBe('Working')
    expect(plainStatus({ ...t, blockedBy: [{}] })).toBe('Blocked')
    expect(plainStatus({ ...t, waiting: 'Waiting: Build is full' })).toBe('Waiting')
    expect(plainStatus(t)).toBe('Queued')
  })
})
