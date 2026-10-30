export const PLAN_MARKER = '<!-- bauherr:plan -->'
export const WORKLOG_MARKER = '<!-- bauherr:worklog -->'
export const DECISIONS_MARKER = '<!-- bauherr:decisions -->'

export type Decision = { id: string; title: string; critical: boolean; default: string; options: string[] }

type Commentish = { body: string }
/** Newest comment starting with `marker`. */
export const latestWith = <T extends Commentish>(comments: T[], marker: string): T | undefined => comments.findLast((c) => c.body.startsWith(marker))

const section = (md: string, heading: RegExp): string =>
  new RegExp(`^##\\s+${heading.source}.*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im').exec(md)?.[1] ?? ''

/**
 * Rows of the plan's `## Decisions` block: `- **D<n> <title>[, critical | — critical]**. Default: … Alternative: …`.
 * Options are the default followed by every Alternative sentence.
 */
export const parseDecisions = (plan: string): Decision[] => {
  const bullets = section(plan, /Decisions\b/).split(/^(?=\s*[-*]\s+\*\*D\d+\b)/m)
  return bullets.flatMap((b) => {
    const m = /^\s*[-*]\s+\*\*(D\d+)\s+(.+?)\*\*[.:]?\s*([\s\S]*)$/.exec(b)
    if (!m) return []
    const [, id, head, rest] = m as unknown as [string, string, string, string]
    const body = rest.replace(/\s+/g, ' ').trim()
    const alternatives = [...body.matchAll(/Alternatives?:\s*(.+?)(?:\.(?=\s|$)|$)/g)].map((a) => a[1]!.trim())
    const def = /^(?:Default:\s*)?(.+?)(?=\s*Alternatives?:|$)/.exec(body)?.[1]?.trim().replace(/\.$/, '') ?? ''
    return [{
      id,
      title: head.replace(/\s*(?:[,—–-]\s*critical|\(critical\))\s*$/i, '').trim(),
      critical: /critical/i.test(head),
      default: def,
      options: [def, ...alternatives],
    }]
  })
}

/** `D<n>: <answer>` lines of a decisions Comment. */
export const parseAnswers = (comment: string): Record<string, string> =>
  Object.fromEntries([...comment.matchAll(/^\s*(?:[-*]\s+)?(D\d+):\s*(.+?)\s*$/gm)].map((m) => [m[1]!, m[2]!]))

export const unansweredCritical = (decisions: Decision[], answers: Record<string, string>): Decision[] =>
  decisions.filter((d) => d.critical && !answers[d.id])

/** Title (first heading, else first line) and the number of numbered items under `## Steps`. */
export const planSummary = (plan: string): { title: string; steps: number } => {
  const body = plan.replace(PLAN_MARKER, '').trim()
  const title = /^#{1,3}\s+(.+)$/m.exec(body)?.[1] ?? body.split('\n')[0] ?? ''
  return { title: title.trim(), steps: (section(plan, /Steps\b/).match(/^\s*\d+\.\s/gm) ?? []).length }
}

/** Unanswered critical rows of the latest plan Comment against the latest decisions Comment. */
export const unansweredCriticalCount = (comments: Commentish[]): number => {
  const plan = latestWith(comments, PLAN_MARKER)
  if (!plan) return 0
  return unansweredCritical(parseDecisions(plan.body), parseAnswers(latestWith(comments, DECISIONS_MARKER)?.body ?? '')).length
}
