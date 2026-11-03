import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decisionsSectionHasRows, openCritical, parseAnswers, subTickets, unansweredCriticalCount, parseDecisions, planSummary, unansweredCritical, withoutDecisions, withoutWorklogHeading } from '../src/app/(app)/lib/plan'
import { renderMarkdown } from '../src/app/(app)/lib/markdown'

const plan = `<!-- bauherr:plan -->
# Plan: dark theme

## Steps
1. Tokens
2. Toggle

## Decisions (defaults; critical needs the owner's word)

- **D1 Storage**. Default: localStorage. Alternative: a cookie. Alternative: the user profile.
- **D2 Delivery, critical**. Default: one approval for all. Alternative: separate approvals.
- **D3 Name — critical**: Default: Dark. Alternative: Night
  or Dusk.

## Risks
- **D9 Not a decision**. Default: x.
`

describe('parseDecisions', () => {
  const rows = parseDecisions(plan)
  it('reads id, title, critical flag, default and options', () => {
    expect(rows.map((r) => [r.id, r.title, r.critical])).toEqual([['D1', 'Storage', false], ['D2', 'Delivery', true], ['D3', 'Name', true]])
    expect(rows[0]).toMatchObject({ default: 'localStorage', options: ['localStorage', 'a cookie', 'the user profile'] })
    expect(rows[2]!.options).toEqual(['Dark', 'Night or Dusk'])
  })
  it('is empty without a Decisions block', () => expect(parseDecisions('# x\n- **D1 a**. Default: b.')).toEqual([]))
})

const plan58 = readFileSync(join(__dirname, 'fixtures/plan-58.md'), 'utf8')
const plan86 = readFileSync(join(__dirname, 'fixtures/plan-86.md'), 'utf8')

describe('parseDecisions shapes', () => {
  it('#58: id alone in bold, Critical: field', () => {
    const rows = parseDecisions(plan58)
    expect(rows.map((r) => [r.id, r.critical])).toEqual([['D1', true], ['D2', true], ['D3', false], ['D4', true], ['D5', false], ['D6', false]])
    expect(rows[0]!.title).toBe('How does the router re-enter the gateway?')
    expect(rows[1]!.title).toBe('Router on by default?')
    expect(rows[3]).toMatchObject({ title: 'Outer-request accounting' })
    expect(rows[3]!.default).toContain('(a)')
    expect(rows[3]!.default).not.toMatch(/Critical/i)
  })
  it('#58: only D4 stays open after D1/D2; D4: a closes it', () => {
    const comments = [{ body: plan58 }, { body: '<!-- bauherr:decisions -->\nD1: x\nD2: y' }]
    expect(openCritical(comments).map((d) => d.id)).toEqual(['D4'])
    expect(openCritical([...comments.slice(0, 1), { body: '<!-- bauherr:decisions -->\nD1: x\nD2: y\nD4: a' }])).toEqual([])
  })
  it('#58: Options (a)/(b) are alternatives', () => {
    expect(parseDecisions(plan58)[3]!.options).toContain('give the router entry its own key kind with `Audit` budget like `owner-session`')
    expect(parseDecisions(plan58)[3]!.options).toHaveLength(2)
  })
  it('#86: critical field inside the bold title is detected and stripped', () => {
    const rows = parseDecisions(plan86)
    expect(rows.map((r) => [r.id, r.critical])).toEqual([['D1', true], ['D2', true], ['D3', true], ['D4', false], ['D5', false], ['D6', false], ['D7', false], ['D8', false]])
    expect(rows[0]!.title).toBe('Access for product users')
    expect(rows[0]!.default).toBe('(a)')
    expect(rows[0]!.options).toHaveLength(2)
    expect(rows[4]!.options).toEqual(['standard for the interview, cheap for the readiness check', 'cheap, standard'])
  })
  it('Options: a / b are alternatives', () => {
    expect(parseDecisions('## Decisions\n- **D1 Pick** Options: red / blue. Default: red.')[0]!.options).toEqual(['red', 'blue'])
  })
  it('canonical bullet with critical true/false', () => {
    const rows = parseDecisions('## Decisions\n- **D1** Keep the name? Alternatives: rename; drop. Default: keep. Why: clients. critical: true.\n- **D2** Page size? Alternatives: 50. Default: 25. critical: false.')
    expect(rows).toMatchObject([{ id: 'D1', title: 'Keep the name?', critical: true, default: 'keep', options: ['keep', 'rename', 'drop'] }, { id: 'D2', critical: false, default: '25', options: ['25', '50'] }])
  })
  it('(critical) and — critical suffixes on the id-alone shape', () => {
    const rows = parseDecisions('## Decisions\n- **D1** Pick a name (critical). Default: a.\n- **D2** Pick a color — critical. Default: b.')
    expect(rows.map((r) => r.critical)).toEqual([true, true])
  })
  it('table rows, header and separator dropped', () => {
    const rows = parseDecisions('## Decisions needed\n\n| # | Question | Options | Default | Why | Critical |\n|---|---|---|---|---|---|\n| D1 | Keep the name? | keep / rename | keep | breaks clients | yes |\n| D2 | Page size | 25 / 50 | 25 | lists | no |\n')
    expect(rows).toMatchObject([{ id: 'D1', title: 'Keep the name?', critical: true, default: 'keep', options: ['keep', 'rename'] }, { id: 'D2', critical: false, options: ['25', '50'] }])
  })
  it('decisionsSectionHasRows', () => {
    expect(decisionsSectionHasRows('## Decisions\n- **x** y')).toBe(true)
    expect(decisionsSectionHasRows('## Decisions\nnone')).toBe(false)
    expect(decisionsSectionHasRows('# x')).toBe(false)
  })
})

const plan57 = `## Decisions (defaults, override by comment; \`critical\` needs your word)

- **D1 Bedrock auth — critical.** Default: Bedrock API key as a file. Alternatives: IAM pair → inline only in v1.6, would sit in \`config.yaml\`; ambient role → shared by all Workspaces, breaks isolation (acceptable later as an explicit \`single-tenant\` mode). Entra for Foundry: same story, later.
- **D2 Scope.** This ticket ships the seven presets with static-key/SA-JSON auth + verification + catalogs. IAM/Entra/ambient auth modes, several providers per Workspace, per-tier providers, and the wizard UI are follow-ups filed now, built when a client needs them.
- **D3 einsfuenf wiring — critical.** Default: chain Bauherr → einsfuenf agentgateway with a new \`AGW_KEY_BAUHERR\` consumer key (budget, audit and GreenPT/RTL key rotation stay where they are; one key to revoke). Alternative: a direct \`greenpt\` Connection with the GreenPT key (cuts a hop, duplicates budget/audit). \`sub/*\` cannot be chained (needs the owner's OAuth header; the Runner has none).
- **D4 Budget without prices.** Default: token budget per Workspace for uncatalogued providers (\`budgetUnit\`, \`budgetTokens30d\`). Alternative: require a catalog upload on the Connection (more work, later).

## Out of scope
`

const plan85 = `## Decisions (defaults; critical needs the owner's word)

- **D1 Shell**: own Next.js route group served at \`/\`. Settled with the owner 2026-10-30.
- **D4 New dependencies (critical)**: \`openid-client\` (OIDC), \`marked\`. Nothing else; no Tailwind.
- **D7 Delivery (critical)**: one approval here covers six sub-tickets created by the factory with \`bauherr:approved:plan\` pre-set; each gets its own Build Run and MR; #85 closes when all are merged. Alternative: six separate plan approvals.
- **D8 Critical path review**: Default: owner reviews. Alternative: none.
`

describe('real plan Comments', () => {
  it('#57: suffix markers, Alternatives lists and rows without Default', () => {
    const rows = parseDecisions(plan57)
    expect(rows.map((r) => [r.id, r.title, r.critical])).toEqual([['D1', 'Bedrock auth', true], ['D2', 'Scope', false], ['D3', 'einsfuenf wiring', true], ['D4', 'Budget without prices', false]])
    expect(rows[0]!.options).toEqual([
      'Bedrock API key as a file',
      'IAM pair → inline only in v1.6, would sit in `config.yaml`',
      'ambient role → shared by all Workspaces, breaks isolation (acceptable later as an explicit `single-tenant` mode)',
      'Entra for Foundry: same story, later',
    ])
    expect(rows[1]).toMatchObject({ default: 'This ticket ships the seven presets with static-key/SA-JSON auth + verification + catalogs', options: [rows[1]!.default] })
    expect(rows[2]!.default).toContain('one key to revoke)')
  })
  it('#85: colon after the bold part, (critical) suffix; "critical" inside a title is not a marker', () => {
    const rows = parseDecisions(plan85)
    expect(rows.map((r) => [r.id, r.title, r.critical])).toEqual([['D1', 'Shell', false], ['D4', 'New dependencies', true], ['D7', 'Delivery', true], ['D8', 'Critical path review', false]])
    expect(rows[2]!.options).toHaveLength(2)
    expect(rows[2]!.options[1]).toBe('six separate plan approvals')
  })
  it('accepts " - critical" and a trailing dot', () => {
    const [r] = parseDecisions('## Decisions\n- **D1 Name - critical.** Default: a. Alternative: b.')
    expect(r).toMatchObject({ title: 'Name', critical: true, options: ['a', 'b'] })
  })
})

it('drops the Decisions block from the plan and the heading from the worklog', () => {
  expect(withoutDecisions(plan)).not.toMatch(/D1 Storage/)
  expect(withoutDecisions(plan)).toMatch(/## Risks/)
  expect(withoutDecisions(plan)).toMatch(/## Steps/)
  expect(withoutWorklogHeading('## Worklog\n**Goal**')).toBe('**Goal**')
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

describe('subTickets', () => {
  const plan = `<!-- bauherr:plan -->
## Steps
1. x

## Sub-tickets
- **Invoice PDF** — Render invoices as PDF.
  Accept: A4, one page.
- **Numbering**: Sequential invoice numbers
* **No body**

## Out of scope
- **Not a sub-ticket** — ignored
`
  it('lists title and body, continuing indented lines, up to the next section', () => {
    expect(subTickets(plan)).toEqual([
      { title: 'Invoice PDF', body: 'Render invoices as PDF.\nAccept: A4, one page.' },
      { title: 'Numbering', body: 'Sequential invoice numbers' },
      { title: 'No body', body: '' },
    ])
  })
  it('is empty without the section', () => expect(subTickets('## Steps\n1. x')).toEqual([]))
  it('reads an `after:` line as the sibling title and keeps it out of the body', () => {
    expect(subTickets('## Sub-tickets\n- **B** — Second.\n  after: A\n  Accept: x\n- **A** — First.')).toEqual([
      { title: 'B', body: 'Second.\nAccept: x', after: 'A' },
      { title: 'A', body: 'First.' },
    ])
  })
})
