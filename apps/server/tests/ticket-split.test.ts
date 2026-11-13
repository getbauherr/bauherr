import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CostPanel, StageStrip } from '../src/app/(app)/components/TicketNow'
import { SPLIT_MAX, SPLIT_MIN, clampWidth } from '../src/app/(app)/components/TicketSplit'

const stages = ['triage', 'plan', 'build', 'review'].map((name) => ({ name, title: name[0]!.toUpperCase() + name.slice(1) }))
const steps = (current: string, visits: [string, number][]) => ({ path: { current, visits: new Map(visits) }, rounds: visits.filter(([, n]) => n > 1).map(([stage, n]) => ({ stage, title: stage, n })) }) as never

describe('ticket split width', () => {
  it('stays within 360-640px', () => {
    expect([clampWidth(100), clampWidth(500), clampWidth(900)]).toEqual([SPLIT_MIN, 500, SPLIT_MAX])
    expect([SPLIT_MIN, SPLIT_MAX]).toEqual([360, 640])
  })
})

describe('stage strip', () => {
  const html = renderToStaticMarkup(createElement(StageStrip, { stages, steps: steps('build', [['triage', 1], ['plan', 1], ['build', 2]]) }))
  it('marks the current stage and shows the rounds of a repeated one', () => {
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="step"[^>]*>Build/)
    expect(html).toContain('×2')
    expect(html).not.toContain('×1')
  })
  it('scrolls instead of wrapping', () => {
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('whitespace-nowrap')
  })
})

describe('cost panel', () => {
  it('sums by stage and lists each Run', () => {
    const html = renderToStaticMarkup(createElement(CostPanel, { runs: [{ id: 1, stage: 'plan', costUsd: 0.5 }, { id: 2, stage: 'build', costUsd: 1.25 }, { id: 3, stage: 'build', costUsd: 0.25 }] }))
    expect(html).toContain('$2.00 total')
    expect(html).toContain('build <span class="mono">$1.50</span>')
    expect(html).toContain('Run #3')
  })
})
