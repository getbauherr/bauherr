import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ApprovalBrief } from '../src/app/(app)/components/ApprovalBrief'
import type { ApprovalBrief as Brief } from '../src/app/(app)/lib/brief'
import { approvalBriefMarkdown, noVisibleReason, parseApprovalBrief } from '../src/lib/approval-brief'

const BODY = `Refs #1

## Approval brief
### What changes for whom
- [visible] Owners see an Approval brief on the Accept on staging card
- [behaviour] The factory stores the brief once per merge commit
- internal: parser module added
- Unmarked bullet

### Not included
- The bar sentence

### Risk and rollback
Low. Revert the merge; the column stays unused.

## Evidence
- tests green
`

const brief = (over: Partial<Brief> = {}): Brief => ({ sha: 'abc', changes: [], notIncluded: [], risk: '', proof: null, noted: [], checks: { ci: 'CI: 3 of 3 checks passed', testsAdded: 2, noProof: [] }, links: [{ label: 'Merge request #7', href: 'https://x/pull/7' }], ...over })

it('parses bullets with their kinds, not-included and risk, and stops at the next section', () => {
  const p = parseApprovalBrief(BODY)
  expect(p.changes).toEqual([
    { kind: 'visible', text: 'Owners see an Approval brief on the Accept on staging card' },
    { kind: 'behaviour', text: 'The factory stores the brief once per merge commit' },
    { kind: 'internal', text: 'parser module added' },
    { kind: 'internal', text: 'Unmarked bullet' },
  ])
  expect(p.notIncluded).toEqual(['The bar sentence'])
  expect(p.risk).toBe('Low. Revert the merge; the column stays unused.')
})

it('keeps at most 7 changes', () => {
  const body = `## Approval brief\n### What changes for whom\n${Array.from({ length: 9 }, (_, i) => `- [visible] c${i}`).join('\n')}\n`
  expect(parseApprovalBrief(body).changes).toHaveLength(7)
})

it('gives empty parts for a missing section or junk, never throwing', () => {
  const empty = { changes: [], notIncluded: [], risk: '' }
  expect(parseApprovalBrief('Refs #1\n\n## Evidence\n- ok')).toEqual(empty)
  expect(parseApprovalBrief('')).toEqual(empty)
  expect(parseApprovalBrief('## Approval brief\nrandom ### text ** [visible\n')).toEqual(empty)
  expect(parseApprovalBrief(undefined as unknown as string)).toEqual(empty)
})

it('says "No visible change" with a reason, with or without bullets', () => {
  const none = renderToStaticMarkup(createElement(ApprovalBrief, { brief: brief() }))
  expect(none).toContain('No visible change.')
  expect(none).toContain('The merge request has no approval brief.')
  const internal = brief({ changes: [{ kind: 'internal', text: 'Refactor the parser' }] })
  expect(noVisibleReason(internal)).toBe('Nothing a person sees changes: Refactor the parser')
  expect(renderToStaticMarkup(createElement(ApprovalBrief, { brief: internal }))).toContain('Refactor the parser')
  expect(approvalBriefMarkdown(internal)).toContain('No visible change.')
  const visible = brief({ changes: [{ kind: 'visible', text: 'A new card' }] })
  expect(renderToStaticMarkup(createElement(ApprovalBrief, { brief: visible }))).not.toContain('No visible change')
  expect(approvalBriefMarkdown(visible)).not.toContain('No visible change')
})

it('renders sections 1 to 6 from the stored brief alone', () => {
  const html = renderToStaticMarkup(createElement(ApprovalBrief, {
    brief: brief({
      changes: [{ kind: 'visible', text: 'A new card' }],
      proof: { ticket: 1, rows: [{ criterion: 'Shows the brief', items: [] }], waived: [], staging: null },
      notIncluded: ['The bar'], risk: 'Low', noted: [{ text: 'nit', reason: 'low' }],
      checks: { ci: 'CI: 3 of 3 checks passed', testsAdded: 2, noProof: [{ rule: 'UI change', reason: 'no browser' }] },
    }),
  }))
  for (const s of ['What changes for whom', 'data-testid="proof-list"', 'Not included', 'Risk and rollback', 'Checks', 'Links']) expect(html).toContain(s)
  expect(html).toContain('No proof for UI change: no browser')
  expect(html).toContain('Noted, not sent back')
  expect(html).toContain('href="https://x/pull/7"')
})
