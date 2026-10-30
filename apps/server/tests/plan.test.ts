import { describe, expect, it } from 'vitest'
import { parseAnswers, unansweredCriticalCount, parseDecisions, planSummary, unansweredCritical, withoutDecisions, withoutWorklogHeading } from '../src/app/(app)/lib/plan'
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
