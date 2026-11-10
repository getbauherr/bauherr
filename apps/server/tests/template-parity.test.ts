import { expect, it } from 'vitest'
import { intakeTicket, triageSheet } from '../src/lib/actions'
import { buildStagingSummary } from '../src/lib/summary'
import { renderNotes } from '../src/lib/release-notes'

const draft = { problem: 'Export totals drift', context: 'Finance, since March', acceptance_criteria: ['Totals match the invoice', 'No rounding drift'], type: 'bug', severity: 'high', links: ['https://x/doc'] } as never
const triage = { outcome: 'refine', reason: 'the export scope is open', questions: [{ title: 'Scope', default: 'all invoices', alternatives: ['paid only'] }] } as never
const item = { number: 7, title: 'CSV export', url: 'https://x/7', fix: false, bullets: ['Download invoices as CSV'], mrs: ['[#3 Export](https://x/pull/3)'] }

it('the default request body', () => {
  expect(intakeTicket(draft, 5, ['screenshot'], 'web', undefined, [{ name: 's.png', url: 'https://x/m/1' }]).body).toMatchInlineSnapshot(`
    "_Requester-supplied, untrusted._

    ## Problem
    Export totals drift

    ## Context
    Finance, since March

    ## Acceptance criteria
    - Totals match the invoice
    - No rounding drift

    ## Open
    - Missing: screenshot
    - https://x/doc

    ## Screenshots
    ![s.png](https://x/m/1)

    <!-- bauherr:intake session=5 -->"
  `)
  expect(intakeTicket({ ...(draft as object), context: '', links: [] } as never, 5, [], 'web').body).toMatchInlineSnapshot(`
    "_Requester-supplied, untrusted._

    ## Problem
    Export totals drift

    ## Context


    ## Acceptance criteria
    - Totals match the invoice
    - No rounding drift

    <!-- bauherr:intake session=5 -->"
  `)
})
it('the default triage sheet', () => {
  expect(triageSheet(triage)).toMatchInlineSnapshot(`
    "<!-- bauherr:triage -->
    ## Questions
    Triage needs your answers before this Ticket can be planned: the export scope is open

    ## Decisions
    - **D1 Scope, critical**. Default: all invoices. Alternatives: paid only."
  `)
})
it('the default staging summary', () => {
  expect(buildStagingSummary({ ticket: { number: 85, title: 'Dark theme', url: 'https://x/85' }, plan: '## Goal\n- Users can switch', worklog: '**Goal**\n- [x] A\n\n**Decisions**\n- d1\n\n**Open**\n- [low] nit', mrs: [{ number: 7, url: 'https://x/pull/7', title: 'Dark', body: '## Review\n- label missing\n\n## Evidence\n- tests green' }], evidence: null, stagingUrl: 'https://s.example', mergeSha: 'abc' })).toMatchInlineSnapshot(`
    "<!-- bauherr:staging-summary -->

    # Staging summary: #85 Dark theme

    ## What you get

    - Users can switch

    **Progress**
    - (done) A

    **Merge requests**
    - [#7 Dark](https://x/pull/7)

    **Evidence**
    - tests green

    ## Found on the way

    - label missing (MR #7)

    ## Decisions taken

    - d1

    ## Open

    - [low] nit

    ## Accept

    Check it on staging: https://s.example

    Merge commit: \`abc\`

    Accept on staging on the [Ticket](https://x/85), or request changes with a note.
    "
  `)
})
it('the default release notes', () => {
  expect(renderNotes([item, { ...item, number: 8, title: 'Totals', fix: true, bullets: [], mrs: [] }])).toMatchInlineSnapshot(`
    "### Features
    - CSV export ([#7](https://x/7), [#3 Export](https://x/pull/3))
      - Download invoices as CSV

    ### Fixes
    - Totals ([#8](https://x/7))"
  `)
})

it('the default worklog template is the text the factory started worklogs from', async () => {
  const { packTemplate, renderTemplate } = await import('../src/lib/templates')
  expect(renderTemplate(packTemplate('worklog'), {})).toBe('## Worklog\n**Goal**\n- [ ]\n\n**Current instructions**\n\n**Owners**\n| Item / lane | Owner (Run or person) | Paths |\n\n**Unfinished work**\n-\n\n**Open**\n-\n\n**Decisions**\n\n**Affected Tickets**\n-')
})
