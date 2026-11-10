/** The texts the factory or its agents write for people; one markdown file each in `pack/templates/`. */
export const TEMPLATE_NAMES = ['request', 'plan', 'decision', ...['review'], 'staging-summary', 'release-note', 'worklog', 'triage-questions'] as const
export type TemplateName = (typeof TEMPLATE_NAMES)[number]
export const isTemplateName = (v: string): v is TemplateName => (TEMPLATE_NAMES as readonly string[]).includes(v)

export type Section = { id: string; heading: string; level: number; /** Fixed text of the section without guidance comments; empty when the code fills it. */ text: string }
export type Parsed = { parsed: Section[]; layout: 'tight' | 'normal'; /** Heading of every id in the pack's own template, for a section the Workspace's template dropped. */ fallback: Record<string, { heading: string; level: number }> }

/** Removes guidance: HTML comments, and the lines that held only a comment. */
export const stripComments = (s: string): string => s.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*(?:\n|$)/gm, '').replace(/<!--[\s\S]*?-->/g, '')
/** The text an agent reads: guidance kept, the `{#id}` anchors dropped. */
export const forAgent = (body: string): string => body.replace(/[ \t]*\{#[\w-]+\}/g, '')

const HEADING = /^(#{2,3})[ \t]+(.+?)[ \t]*$/

/** Sections of a template body: `## Heading {#id}` (an anchor names what the code puts there; without one the heading text is the id). */
export const parseSections = (body: string): Section[] => {
  const out: { id: string; heading: string; level: number; lines: string[] }[] = []
  for (const line of body.split('\n')) {
    const h = HEADING.exec(line)
    if (h) {
      const anchor = /^(.*?)[ \t]*\{#([\w-]+)\}$/.exec(h[2]!)
      out.push({ id: anchor?.[2] ?? h[2]!, heading: anchor?.[1] ?? h[2]!, level: h[1]!.length, lines: [] })
    } else out.at(-1)?.lines.push(line)
  }
  return out.map((s) => ({ id: s.id, heading: s.heading, level: s.level, text: stripComments(s.lines.join('\n')).trim() }))
}

const block = (level: number, heading: string, content: string, gap: string) => `${'#'.repeat(level)} ${heading}${gap}${content}`

/**
 * Fills the template's sections, in the template's order and under its heading text, from `sections` (by anchor id).
 * A section the code gives nothing for is left out unless the template has fixed text for it; content for an id the template dropped
 * is appended under the pack's heading. Guidance comments never reach the output.
 */
export const renderTemplate = (tpl: Parsed, sections: Record<string, string>): string => {
  const gap = tpl.layout === 'tight' ? '\n' : '\n\n'
  const out = tpl.parsed.flatMap((s) => (s.id in sections ? [block(s.level, s.heading, sections[s.id]!, gap)] : s.text ? [block(s.level, s.heading, s.text, gap)] : []))
  const known = new Set(tpl.parsed.map((s) => s.id))
  for (const [id, content] of Object.entries(sections)) {
    if (known.has(id)) continue
    const f = tpl.fallback[id]
    out.push(block(f?.level ?? tpl.parsed[0]?.level ?? 2, f?.heading ?? id, content, gap))
  }
  return out.join('\n\n')
}

/** Heading text of the section with this anchor in the Workspace's template (the default text when it is not there). */
export const headingOf = (tpl: Pick<Parsed, 'parsed' | 'fallback'>, id: string): string => tpl.parsed.find((s) => s.id === id)?.heading ?? tpl.fallback[id]?.heading ?? id

export type Finding = { level: 'error' | 'warn'; message: string }

/** Per template: the anchors the code fills, headings its parsers locate by text, and literal lines it edits. */
const RULES: Record<TemplateName, { ids: string[]; exact?: Record<string, string>; contains?: string[] }> = {
  request: { ids: ['problem', 'context', 'acceptance-criteria'], exact: { 'acceptance-criteria': 'Acceptance criteria' } },
  plan: { ids: ['tldr', 'goal', 'steps'], exact: { goal: 'Goal', steps: 'Steps', files: 'Files', decisions: 'Decisions', 'sub-tickets': 'Sub-tickets' }, contains: ['Decision:', 'Recommendation:', 'Why:', 'Risk:'] },
  decision: { ids: ['decision'] },
  review: { ids: ['verdict', 'findings'] },
  'staging-summary': { ids: ['what-you-get', 'accept'] },
  'release-note': { ids: [] },
  worklog: { ids: [], contains: ['**Goal**', '**Current instructions**', '**Unfinished work**', '**Open**', '**Decisions**'] },
  'triage-questions': { ids: ['questions', 'decisions'], exact: { decisions: 'Decisions' } },
}

/** Findings that make a body unfit to save (`error`) or worth a look (`warn`). */
export const lintTemplate = (name: TemplateName, body: string): Finding[] => {
  const rule = RULES[name]
  const parsed = parseSections(body)
  const f: Finding[] = []
  if (!body.trim()) return [{ level: 'error', message: 'The template is empty.' }]
  const seen = new Set<string>()
  for (const s of parsed) {
    if (seen.has(s.id)) f.push({ level: 'error', message: `Two sections share the anchor {#${s.id}}.` })
    seen.add(s.id)
  }
  for (const id of rule.ids) if (!seen.has(id)) f.push({ level: 'error', message: `The section {#${id}} is missing: the factory fills it.` })
  for (const [id, heading] of Object.entries(rule.exact ?? {})) {
    const s = parsed.find((x) => x.id === id)
    if (s && s.heading !== heading) f.push({ level: 'error', message: `The heading of {#${id}} must stay "${heading}": the factory finds it by that text.` })
  }
  const text = stripComments(body)
  for (const c of rule.contains ?? []) if (!text.includes(c)) f.push({ level: 'error', message: `The text "${c}" is missing: the factory or its agents rely on it.` })
  if (!parsed.length) f.push({ level: 'warn', message: 'No "## Heading" sections found.' })
  return f
}


/** Sample content per template for the editor's preview, keyed by anchor id. */
export const SAMPLES: Record<TemplateName, Record<string, string>> = {
  request: { problem: 'Export totals drift from the invoice.', context: 'Finance, since March, about once a week.', 'acceptance-criteria': '- Totals match the invoice\n- No rounding drift', open: '- Missing: screenshot' },
  plan: {},
  decision: { decision: 'Approve the plan for "Login redirect"', recommendation: 'Approve: one file changes and a test covers it.', why: '- One file changes\n- A regression test is added', options: '- **Approve plan**: Build starts when a slot is free.', next: 'Build starts when a slot is free.' },
  review: { verdict: 'changes', findings: '- [medium] src/a.ts:12 The retry never stops. Scenario: when the gateway answers 402, then it retries forever.', open: '- [low] Unused import', checked: '- correctness: traced the retry path' },
  'staging-summary': { 'what-you-get': '- Users can switch to a dark theme\n\n**Merge requests**\n- [#7 Dark theme](https://example.com/7)', found: '- Toggle lacked a label (MR #7)', decisions: '- Use CSS custom properties', open: 'Nothing.', accept: 'Check it on staging, then accept or request changes.' },
  'release-note': { features: '- CSV export ([#7](https://example.com/7))\n  - Download invoices as CSV', fixes: '- Totals wrong ([#8](https://example.com/8))' },
  worklog: {},
  'triage-questions': { questions: 'Triage needs your answers before this Ticket can be planned: the export scope is open', decisions: '- **D1 Scope, critical**. Default: all invoices. Alternatives: paid only.' },
}
