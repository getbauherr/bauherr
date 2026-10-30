export const PLAN_MARKER = '<!-- bauherr:plan -->'
export const WORKLOG_MARKER = '<!-- bauherr:worklog -->'
export const TRIAGE_MARKER = '<!-- bauherr:triage -->'
export const DECISIONS_MARKER = '<!-- bauherr:decisions -->'

export type Decision = { id: string; title: string; critical: boolean; default: string; options: string[] }

type Commentish = { body: string }
/** Newest comment starting with `marker`. */
export const latestWith = <T extends Commentish>(comments: T[], marker: string): T | undefined => comments.findLast((c) => c.body.startsWith(marker))
/** Oldest comment starting with `marker` (the worklog is one comment per ticket, first wins). */
export const firstWith = <T extends Commentish>(comments: T[], marker: string): T | undefined => comments.find((c) => c.body.startsWith(marker))

const section = (md: string, heading: RegExp): string =>
  new RegExp(`^##\\s+${heading.source}.*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im').exec(md)?.[1] ?? ''

/** Splits at `;` (when `semi`) and at `.` followed by whitespace, ignoring parentheses and code spans. */
const split = (text: string, semi: boolean): string[] => {
  const out: string[] = []
  let cur = ''
  let depth = 0
  let code = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    cur += c
    if (c === '`') code = !code
    else if (!code && c === '(') depth++
    else if (!code && c === ')') depth = Math.max(0, depth - 1)
    else if (!code && !depth && ((semi && c === ';') || (c === '.' && /\s/.test(text[i + 1] ?? ' ')))) {
      out.push(cur)
      cur = ''
    }
  }
  out.push(cur)
  return out.map((x) => x.replace(/[;.]$/, '').trim()).filter(Boolean)
}

const CRITICAL = /(?:,\s*|\s+[—–-]\s+)critical\s*\.?$|\s*\(critical\)\s*\.?$/i

/**
 * Rows of the plan's `## Decisions` block: `- **D<n> <title>[, critical | — critical | - critical | (critical)]**. Default: … Alternative(s): …`.
 * Without `Default:` the default is the first sentence. Alternatives split at `;` and sentence ends, one option each.
 */
export const parseDecisions = (plan: string): Decision[] => {
  const bullets = section(plan, /Decisions\b/).split(/^(?=\s*[-*]\s+\*\*D\d+\b)/m)
  return bullets.flatMap((b) => {
    const m = /^\s*[-*]\s+\*\*(D\d+)\s+(.+?)\*\*[.:]?\s*([\s\S]*)$/.exec(b)
    if (!m) return []
    const [, id, head, rest] = m as unknown as [string, string, string, string]
    const body = rest.replace(/\s+/g, ' ').trim()
    const alternatives = [...body.matchAll(/Alternatives?:\s*(.+?)(?=\s*Alternatives?:|$)/g)].flatMap((a) => split(a[1]!, true))
    const lead = /^(.*?)(?=\s*Alternatives?:|$)/.exec(body)![1]!.replace(/^Default:\s*/, '')
    const def = (split(lead, false)[0] ?? '').trim()
    const title = head.replace(/\.$/, '')
    return [{
      id,
      title: title.replace(CRITICAL, '').trim(),
      critical: CRITICAL.test(title),
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

/** The decision sheet in force: the newest plan or triage Comment (triage questions use the plan's `## Decisions` format). */
export const sheetOf = <T extends Commentish>(comments: T[]): T | undefined => comments.findLast((c) => c.body.startsWith(PLAN_MARKER) || c.body.startsWith(TRIAGE_MARKER))

/** The decisions Comment posted after the sheet in force: answers to an older sheet do not count for a newer one. */
export const answersOf = <T extends Commentish>(comments: T[]): T | undefined => {
  const sheet = sheetOf(comments)
  return sheet ? latestWith(comments.slice(comments.indexOf(sheet) + 1), DECISIONS_MARKER) : undefined
}

/** Unanswered critical rows of the sheet in force against the latest decisions Comment. */
export const openCritical = (comments: Commentish[]): Decision[] => {
  const sheet = sheetOf(comments)
  if (!sheet) return []
  return unansweredCritical(parseDecisions(sheet.body), parseAnswers(answersOf(comments)?.body ?? ''))
}

export const unansweredCriticalCount = (comments: Commentish[]): number => openCritical(comments).length

/** Plan markdown without its `## Decisions` block (the sheet shows it). */
export const withoutDecisions = (plan: string): string => plan.replace(/^##\s+Decisions\b.*$[\s\S]*?(?=^##\s|(?![\s\S]))/im, '')

/** Worklog markdown without its leading `## Worklog` heading (the page has one). */
export const withoutWorklogHeading = (md: string): string => md.replace(/^\s*##\s+Worklog\s*\n/i, '')
