/** The plan's leading `## TL;DR` block: labelled lines the Inbox card is made from. */
export type PlanTldr = { decision: string; recommendation: string; why: string[]; risk: string; options: string[] }

export const TLDR_HEADING = 'TL;DR'
export const MAX_WHY = 3
const LABELS = ['Decision', 'Recommendation', 'Why', 'Risk', 'Options'] as const
const LABEL = new RegExp(`^\\s*(?:[-*]\\s+)?\\**(${LABELS.join('|')})\\**\\s*:\\**\\s*(.*)$`, 'i')
const bullet = (l: string) => /^\s*(?:[-*]|\d+\.)\s+(.*\S)/.exec(l)?.[1]
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Body of the `## <heading>` section of `md` (up to the next `##`), or null. */
export const tldrSection = (md: string, heading = TLDR_HEADING): string | null => {
  const m = new RegExp(`^##[ \\t]+${escape(heading)}[ \\t]*$([\\s\\S]*?)(?=^##[ \\t]|(?![\\s\\S]))`, 'im').exec(md)
  return m ? m[1]! : null
}

/** Parses the TL;DR block; `missing` names every label that is absent or empty, `problems` anything else wrong. */
export const parseTldr = (md: string, heading = TLDR_HEADING): { tldr: PlanTldr | null; missing: string[]; problems: string[] } => {
  const body = tldrSection(md, heading)
  if (body === null) return { tldr: null, missing: [...LABELS.slice(0, 4)], problems: [`The plan has no \`## ${heading}\` section`] }
  const text: Record<string, string> = {}
  const list: Record<string, string[]> = { Why: [], Options: [] }
  let label: (typeof LABELS)[number] | null = null
  for (const line of body.split('\n')) {
    const m = LABEL.exec(line)
    if (m) {
      label = LABELS.find((l) => l.toLowerCase() === m[1]!.toLowerCase())!
      const rest = m[2]!.trim()
      if (label in list) {
        if (rest) list[label]!.push(rest)
      } else text[label] = rest
    } else if (label && line.trim()) {
      const b = bullet(line)
      if (label in list) list[label]!.push(b ?? line.trim())
      else text[label] = `${text[label] ?? ''} ${line.trim()}`.trim()
    }
  }
  const missing = LABELS.slice(0, 4).filter((l) => (l in list ? !list[l]!.length : !text[l]))
  const problems = list.Why!.length > MAX_WHY ? [`Why: has ${list.Why!.length} bullets, at most ${MAX_WHY}`] : []
  return { tldr: missing.length ? null : { decision: text.Decision!, recommendation: text.Recommendation!, why: list.Why!, risk: text.Risk!, options: list.Options! }, missing, problems }
}

/** The error text for a plan without a usable TL;DR, or null when it has one. A `##` heading before the TL;DR breaks "leading". */
export const tldrError = (md: string, heading = TLDR_HEADING): string | null => {
  const { missing, problems } = parseTldr(md, heading)
  const first = /^##[ \t]+(.+?)[ \t]*$/m.exec(md)?.[1]
  if (first && first.toLowerCase() !== heading.toLowerCase() && !missing.length) problems.push(`\`## ${heading}\` must be the first section`)
  if (!missing.length && !problems.length) return null
  return `The plan needs a leading \`## ${heading}\` section with these lines: \`Decision:\` (one sentence: what the owner decides), \`Recommendation:\` (what you recommend and why), \`Why:\` (1 to ${MAX_WHY} bullets), \`Risk:\` (one line, or "none"); \`Options:\` (bullets) is optional.${missing.length ? ` Missing: ${missing.map((m) => `\`${m}:\``).join(', ')}.` : ''}${problems.length ? ` ${problems.join('; ')}.` : ''}`
}
