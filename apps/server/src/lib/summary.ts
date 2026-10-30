export const SUMMARY_MARKER = '<!-- bauherr:staging-summary -->'

export interface SummaryInput {
  ticket: { number: number; title: string; url: string }
  /** Plan Comment body (with `## Steps`), if any. */
  plan: string | null
  /** Worklog markdown (Goal, Decisions, Unfinished work). */
  worklog: string | null
  mrs: { number: number; url: string; title: string; body: string }[]
  /** Evidence of the latest build Run. */
  evidence: string | null
  stagingUrl: string | null
  /** Merge commit; makes a re-release (after requested changes) a new summary. */
  mergeSha: string | null
}

/** Body of a `## Name` heading or a `**Name**` line, up to the next one. */
const section = (md: string, name: string): string => {
  const rows = md.split('\n')
  const head = (l: string) => /^##\s+(.+?)\s*$/.exec(l)?.[1] ?? /^\*\*(.+)\*\*\s*$/.exec(l.trim())?.[1]
  const start = rows.findIndex((l) => head(l)?.toLowerCase() === name.toLowerCase())
  if (start < 0) return ''
  const end = rows.findIndex((l, i) => i > start && head(l))
  return rows.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}

const bullets = (md: string): string[] =>
  md.split('\n').map((l) => /^\s*(?:[-*]|\d+\.)\s+(.*\S)/.exec(l)?.[1]).filter((x): x is string => !!x && x !== '-')

const list = (items: string[], empty: string): string => (items.length ? items.map((i) => `- ${i}`).join('\n') : empty)

/** Markdown staging summary from structured data; no model call. Starts with {@link SUMMARY_MARKER}. */
export const buildStagingSummary = ({ ticket, plan, worklog, mrs, evidence, stagingUrl, mergeSha }: SummaryInput): string => {
  const steps = bullets(section(plan ?? '', 'Steps'))
  const goals = bullets(section(worklog ?? '', 'Goal')).map((g) => g.replace(/^\[( |x)\]\s*/i, (_, m) => (m === ' ' ? '(open) ' : '(done) ')).trim())
  const decisions = bullets(section(worklog ?? '', 'Decisions'))
  const open = bullets(section(worklog ?? '', 'Unfinished work')).filter((x) => !/^none\.?$/i.test(x))
  const findings = mrs.flatMap((m) => bullets(section(m.body, 'Review')).map((f) => `${f} (MR #${m.number})`))
  const proof = evidence ?? mrs.map((m) => section(m.body, 'Evidence')).find(Boolean) ?? ''
  return [
    SUMMARY_MARKER,
    `# Staging summary: #${ticket.number} ${ticket.title}`,
    '## What you get',
    ...(steps.length ? [list(steps, ''), ''] : []),
    `**Goal**\n${list(goals, 'No Goal recorded.')}`,
    `**Merge requests**\n${list(mrs.map((m) => `[#${m.number} ${m.title}](${m.url})`), 'None linked.')}`,
    ...(proof ? [`**Evidence**\n${proof}`] : []),
    '## Found on the way',
    list(findings, 'Nothing recorded.'),
    '## Decisions taken',
    list(decisions, 'None.'),
    '## Open',
    list(open, 'Nothing.'),
    '## Accept',
    `${stagingUrl ? `Check it on staging: ${stagingUrl}\n\n` : ''}${mergeSha ? `Merge commit: \`${mergeSha}\`\n\n` : ''}Accept on staging on the [Ticket](${ticket.url}), or request changes with a note.`,
  ].join('\n\n') + '\n'
}
