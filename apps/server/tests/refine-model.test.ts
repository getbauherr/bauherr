import { describe, expect, it } from 'vitest'
import { dropLine, formatDecision, parseAnswers, parseDecisions, readAnswer } from '../src/app/(app)/lib/plan'
import { MAX_OPEN, applyRefine, lineDiff, normalizeRefine, openOf, pointsOf, type Point, type Refine } from '../src/lib/refine/model'

const SHEET = `<!-- bauherr:triage -->
## Decisions
- **D1 Which format, critical**. Default: CSV. Alternatives: XLSX; JSON. Why: Finance uses Excel.
- **D2 Who may export**. Default: Admins only. Alternative: everyone.
- **D3 Name by date**. Default: yes.
`
const sheet = parseDecisions(SHEET)
const points = (answers: Record<string, string> = {}) => pointsOf(sheet, [], answers, 7)
const ok = (r: Partial<Refine> & Record<string, unknown>) => ({ reply: 'ok', settled: [], dropped: [], added: [], next: 'ask', ...r })
const body = '## Problem\nx\n<!-- bauherr:intake session=1 -->'

describe('points', () => {
  it('reads an old sheet and old answers unchanged: rows, critical first, answered ones marked', () => {
    const ps = points({ D2: 'Admins only' })
    expect(ps.map((p) => [p.id, p.status, p.source])).toEqual([['D1', 'open', 'triage'], ['D2', 'answered', 'triage'], ['D3', 'open', 'triage']])
    expect(ps[0]).toMatchObject({ critical: true, default: 'CSV', options: ['CSV', 'XLSX', 'JSON'], why: 'Finance uses Excel', run: 7 })
  })

  it('a dropped row counts as answered for every sheet reader and reads back as dropped', () => {
    const a = parseAnswers(`<!-- bauherr:decisions -->\nD1: CSV\nD3: ${dropLine('not needed')}`)
    expect(a.D3).toBe('(no longer needed) not needed')
    expect(readAnswer(a.D3!)).toEqual({ dropped: true, text: 'not needed' })
    expect(points(a).map((p) => p.status)).toEqual(['answered', 'open', 'dropped'])
  })

  it('an added row survives the round trip through the decisions Comment format', () => {
    const d = { id: 'D4', title: 'Include archived? Really', why: 'Large. Slow', options: ['No', 'Yes; all of them'], default: 'No', critical: false }
    const [back] = parseDecisions(`<!-- bauherr:decisions -->\nD1: x\n\n## Decisions\n${formatDecision(d)}`)
    expect(back).toMatchObject({ id: 'D4', critical: false, default: 'No', options: ['No', 'Yes, all of them'] })
    expect(back!.title).toBe('Include archived, Really?')
  })
})

describe('normalizeRefine', () => {
  const ps = points()
  it('takes a valid result, also two points at once, and trims the words', () => {
    const r = normalizeRefine(ok({ reply: '  Both  noted. ', settled: [{ id: 'D1', answer: 'XLSX\n' }, { id: 'D2', answer: 'everyone' }], dropped: [{ id: 'D3', reason: 'moot' }] }), ps, { body })
    expect(r.settled).toEqual([{ id: 'D1', answer: 'XLSX' }, { id: 'D2', answer: 'everyone' }])
    expect(r.reply).toBe('Both noted.')
  })
  it.each([
    ['no reply', ok({ reply: ' ' })],
    ['an unknown point', ok({ settled: [{ id: 'D9', answer: 'x' }] })],
    ['a point settled and dropped', ok({ settled: [{ id: 'D1', answer: 'x' }], dropped: [{ id: 'D1', reason: '' }] })],
    ['an empty answer', ok({ settled: [{ id: 'D1', answer: ' ' }] })],
    ['a long answer', ok({ settled: [{ id: 'D1', answer: 'x'.repeat(501) }] })],
    ['four added points', ok({ added: [1, 2, 3, 4].map((n) => ({ question: `Q${n}` })) })],
    ['a bad next', ok({ next: 'later' })],
    ['ticket text without the marker', ok({ ticket: { body: '## Problem\nnew' } })],
    ['not an object', null],
  ])('refuses %s', (_, raw) => {
    expect(() => normalizeRefine(raw, ps, { body })).toThrow('invalid refine result')
  })
  it('refuses a point that is already answered', () => {
    expect(() => normalizeRefine(ok({ settled: [{ id: 'D2', answer: 'x' }] }), points({ D2: 'a' }), { body })).toThrow('unknown or repeated')
  })
  it('keeps ticket edits that keep the markers', () => {
    expect(normalizeRefine(ok({ ticket: { title: ' New  title ', body: '## Problem\nnew\n<!-- bauherr:intake session=1 -->' } }), ps, { body }).ticket).toEqual({ title: 'New title', body: '## Problem\nnew\n<!-- bauherr:intake session=1 -->' })
  })
})

describe('applyRefine', () => {
  const r = (x: Partial<Refine>): Refine => ({ reply: 'x', settled: [], dropped: [], added: [], next: 'ask', ...x })
  it('marks settled and dropped and numbers new points after the highest id', () => {
    const out = applyRefine(points(), r({ settled: [{ id: 'D1', answer: 'XLSX' }], dropped: [{ id: 'D2', reason: 'moot' }], added: [{ title: 'Which sheet name?', options: ['Invoices'], default: 'Invoices' }] }))
    expect(out.points.map((p) => [p.id, p.status])).toEqual([['D1', 'answered'], ['D2', 'dropped'], ['D3', 'open'], ['D4', 'open']])
    expect(out.added).toEqual([expect.objectContaining({ id: 'D4', critical: false })])
    expect(out.points.at(-1)).toMatchObject({ source: 'conversation' })
  })
  it('caps the open points at ten and says so', () => {
    const many: Point[] = Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}`, title: 't', options: [], default: '', critical: false, status: 'open', source: 'triage' }))
    const out = applyRefine(many, r({ added: [{ title: 'a', options: [], default: '' }, { title: 'b', options: [], default: '' }] }))
    expect(openOf(out.points)).toHaveLength(MAX_OPEN)
    expect(out).toMatchObject({ capped: true, added: [{ id: 'D10' }] })
  })
})

describe('lineDiff', () => {
  it('shows changed lines with their neighbours only', () => {
    const d = lineDiff('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nX\ne\nf\ng')
    expect(d.filter((l) => l.kind !== 'context')).toEqual([{ kind: 'removed', text: 'd' }, { kind: 'added', text: 'X' }])
    expect(d.map((l) => l.text)).not.toContain('a')
  })
})
