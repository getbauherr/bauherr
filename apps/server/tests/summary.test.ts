import { expect, it } from 'vitest'
import { SUMMARY_MARKER, buildStagingSummary } from '../src/lib/summary'

const PLAN = `<!-- bauherr:plan -->
# Plan: dark theme

## Goal
- Users can switch to a dark theme

## Steps
1. Add colour tokens for the dark palette
2. Wire the theme toggle into the top bar
`

const WORKLOG = `<!-- bauherr:worklog -->
## Worklog
**Goal**
- [x] A dark theme exists
- [ ] Docs updated

**Current instructions**
Nothing.

**Unfinished work**
- Contrast audit - open - owner

**Decisions**
- 2026-10-30 Use CSS custom properties. Consequence: no runtime theme library. By: plan Run.
`

const mr = { number: 7, url: 'https://x/pull/7', title: 'Dark theme (#85)', body: 'Closes #85\n\n## Review\n- Toggle lacked a label (fixed)\n\n## Evidence\n- tests green\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n' }

it('renders the sections, marker first, from structured data', () => {
  const md = buildStagingSummary({ ticket: { number: 85, title: 'Dark theme', url: 'https://x/85' }, plan: PLAN, worklog: WORKLOG, mrs: [mr], evidence: null, stagingUrl: 'https://staging.example', mergeSha: 'abc123' })
  expect(md.startsWith(SUMMARY_MARKER)).toBe(true)
  const heads = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])
  expect(heads).toEqual(['What you get', 'Found on the way', 'Decisions taken', 'Open', 'Accept'])
  expect(md).toContain('- Users can switch to a dark theme')
  expect(md).not.toContain('colour tokens')
  expect(md).toContain('- (done) A dark theme exists')
  expect(md).toContain('- (open) Docs updated')
  expect(md).toContain('[#7 Dark theme (#85)](https://x/pull/7)')
  expect(md).toContain('- tests green')
  expect(md).not.toContain('Generated with')
  expect(md).toContain('- Toggle lacked a label (fixed) (MR #7)')
  expect(md).toContain('Use CSS custom properties')
  expect(md).toContain('- Contrast audit - open - owner')
  expect(md).toContain('Check it on staging: https://staging.example')
  expect(md).toContain('`abc123`')
})

it('degrades to explicit empty statements without sources', () => {
  const md = buildStagingSummary({ ticket: { number: 1, title: 't', url: 'u' }, plan: null, worklog: null, mrs: [], evidence: null, stagingUrl: null, mergeSha: null })
  expect(md).toContain('No Goal recorded.')
  expect(md).toContain('None linked.')
  expect(md).toContain('Nothing recorded.')
  expect(md).not.toContain('Check it on staging')
})

it('takes a prose Review section as one finding', () => {
  const prose = { ...mr, body: 'x\n\n## Review\nReviewer agent: 2 findings,\nboth fixed.\n\n## Evidence\n- ok\n' }
  const md = buildStagingSummary({ ticket: { number: 1, title: 't', url: 'u' }, plan: null, worklog: null, mrs: [prose], evidence: null, stagingUrl: null, mergeSha: null })
  expect(md).toContain('- Reviewer agent: 2 findings, both fixed. (MR #7)')
})
