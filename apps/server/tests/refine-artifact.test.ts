import { describe, expect, it } from 'vitest'
import { buildArtifact, sectionsOf } from '../src/lib/refine/artifact'
import type { Point } from '../src/lib/refine/model'

const point = (id: string, title: string, status: Point['status'] = 'open'): Point => ({ id, title, options: [], default: '', critical: false, status, source: 'triage' })
const body = '<!-- bauherr:ticket -->\nA recurring Docs Agent.\n\n## Trigger\nManually.\n\n## Acceptance criteria\n- It runs\n'
const build = (pending: string, points: Point[] = [], title = 'T') => buildArtifact({ title, currentTitle: 'T', current: body, pending, points, version: { n: 1, at: null } })

describe('sectionsOf', () => {
  it('splits by heading, hides markers, and names the text before the first heading Summary', () => {
    expect(sectionsOf(body).map((s) => [s.heading, s.text])).toEqual([['Summary', 'A recurring Docs Agent.'], ['Trigger', 'Manually.'], ['Acceptance criteria', '- It runs']])
  })
  it('keeps repeated headings apart', () => {
    expect(sectionsOf('## A\nx\n\n## A\ny').map((s) => s.key)).toEqual(['a', 'a#2'])
  })
})

describe('buildArtifact', () => {
  it('marks nothing as changed without edits', () => {
    const a = build(body)
    expect(a.sections.every((s) => !s.changed)).toBe(true)
    expect(a).toMatchObject({ changes: 0, hunks: [], titleChanged: false })
  })

  it('marks a changed and a new section, and gives one hunk each; the untouched ones stay', () => {
    const a = build(body.replace('Manually.', 'Manually, by the owner.') + '\n## Decisions\n- Scope: the published docs\n')
    expect(a.sections.filter((s) => s.changed).map((s) => s.heading)).toEqual(['Trigger', 'Decisions'])
    expect(a.hunks.map((h) => h.range)).toEqual(['Trigger', 'Decisions'])
    expect(a.hunks[0]!.lines).toEqual([{ kind: 'removed', text: 'Manually.' }, { kind: 'added', text: 'Manually, by the owner.' }])
    expect(a.changes).toBe(2)
  })

  it('reports a removed section, and a title change counts as a change', () => {
    const a = build('A recurring Docs Agent.', [], 'New title')
    expect(a.hunks.map((h) => h.range)).toEqual(['Summary (removed)'].filter(() => false).concat(['Trigger (removed)', 'Acceptance criteria (removed)']))
    expect(a).toMatchObject({ titleChanged: true, changes: 3 })
  })

  it('puts a placeholder per open point before the acceptance criteria; the first open one is the one asked now', () => {
    const a = build(body, [point('D1', 'What triggers it?', 'answered'), point('D2', 'Which docs?'), point('D3', 'How is staleness judged?')])
    expect(a.sections.map((s) => s.heading)).toEqual(['Summary', 'Trigger', 'Which docs?', 'How is staleness judged?', 'Acceptance criteria'])
    expect(a.sections.filter((s) => s.point).map((s) => [s.point!.id, s.point!.now, s.text])).toEqual([['D2', true, 'Waiting for your answer: Which docs?'], ['D3', false, 'Open: How is staleness judged?']])
  })

  it('appends placeholders at the end when the text has no acceptance section', () => {
    const a = buildArtifact({ title: 'T', currentTitle: 'T', current: '## Problem\nx', pending: '## Problem\nx', points: [point('D1', 'Q?')], version: { n: 3, at: '2026-11-12T13:36:00Z' } })
    expect(a.sections.map((s) => s.heading)).toEqual(['Problem', 'Q?'])
    expect(a.version.n).toBe(3)
  })
})
