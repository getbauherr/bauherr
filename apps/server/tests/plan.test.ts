import { describe, expect, it } from 'vitest'
import { parseAnswers, unansweredCriticalCount, parseDecisions, planSummary, unansweredCritical } from '../src/app/(app)/lib/plan'
import { renderMarkdown } from '../src/app/(app)/lib/markdown'

const plan = `<!-- bauherr:plan -->
# Plan: dark theme

## Steps
1. Tokens
2. Toggle

## Decisions (defaults; critical needs the owner's word)

- **D1 Storage**. Default: localStorage. Alternative: a cookie. Alternative: the user profile.
- **D2 Delivery, critical**. Default: one approval for all. Alternative: separate approvals.
- **D3 Name — critical**: Default: Dark. Alternative: Night.
  Second line.

## Risks
- **D9 Not a decision**. Default: x.
`

describe('parseDecisions', () => {
  const rows = parseDecisions(plan)
  it('reads id, title, critical flag, default and options', () => {
    expect(rows.map((r) => [r.id, r.title, r.critical])).toEqual([['D1', 'Storage', false], ['D2', 'Delivery', true], ['D3', 'Name', true]])
    expect(rows[0]).toMatchObject({ default: 'localStorage', options: ['localStorage', 'a cookie', 'the user profile'] })
    expect(rows[2]!.options).toEqual(['Dark', 'Night'])
  })
  it('is empty without a Decisions block', () => expect(parseDecisions('# x\n- **D1 a**. Default: b.')).toEqual([]))
})

describe('answers', () => {
  const rows = parseDecisions(plan)
  it('parses D<n>: lines in plain and bullet form', () => {
    expect(parseAnswers('<!-- bauherr:decisions -->\nD1: a cookie\n- D2: separate approvals')).toEqual({ D1: 'a cookie', D2: 'separate approvals' })
  })
  it('lists unanswered critical rows only', () => {
    expect(unansweredCritical(rows, { D2: 'x' }).map((d) => d.id)).toEqual(['D3'])
    expect(unansweredCritical(rows, { D2: 'x', D3: 'y' })).toEqual([])
  })
})

it('summarises title and step count', () => expect(planSummary(plan)).toEqual({ title: 'Plan: dark theme', steps: 2 }))

it('escapes raw HTML and drops unsafe links and images', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\nx <b>y</b> [x](javascript:alert(1)) ![pic](http://a/b.png) [ok](https://a.b)')
  expect(html).not.toMatch(/<script|<b>|javascript:|<img/)
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('<a href="https://a.b"')
})

it('counts unanswered critical rows across the latest plan and decisions Comments', () => {
  const comments = [{ body: plan }]
  expect(unansweredCriticalCount(comments)).toBe(2)
  expect(unansweredCriticalCount([...comments, { body: '<!-- bauherr:decisions -->\nD2: x\nD3: y' }])).toBe(0)
  expect(unansweredCriticalCount([])).toBe(0)
})
