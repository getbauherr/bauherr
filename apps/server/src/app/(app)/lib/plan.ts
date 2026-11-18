import type { Kind } from '../../../lib/workflow-rules'

export const PLAN_MARKER = '<!-- bauherr:plan -->'
export const WORKLOG_MARKER = '<!-- bauherr:worklog -->'
export const TRIAGE_MARKER = '<!-- bauherr:triage -->'
export const ESCALATION_MARKER = '<!-- bauherr:escalation -->'
export const INVESTIGATION_MARKER = '<!-- bauherr:investigation -->'
export const SECURITY_FINDING_MARKER = (key: string) => `<!-- bauherr:security-finding:${key} -->`
export const DECISIONS_MARKER = '<!-- bauherr:decisions -->'

export type Decision = { id: string; title: string; critical: boolean; default: string; options: string[]; /** The row's `Why:` text, when it has one. */ why?: string; /** Who answers the row (`for: product-owner | bauherr`); absent = whom the checkpoint asks. */ for?: 'bauherr' | 'product-owner' }

type Commentish = { body: string; /** Forge login of the writer; the decisions Comments are vetted by it (`lib/forge-channel.ts`). */ author?: string }
export const latestWith = <T extends Commentish>(comments: T[], marker: string): T | undefined => comments.findLast((c) => c.body.startsWith(marker))
export const firstWith = <T extends Commentish>(comments: T[], marker: string): T | undefined => comments.find((c) => c.body.startsWith(marker))

const section = (md: string, heading: RegExp): string =>
  new RegExp(`^##\\s+${heading.source}.*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im').exec(md)?.[1] ?? ''

const split = (text: string, semi: boolean, q = false): string[] => {
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
    else if (!code && !depth && ((semi && c === ';') || ((c === '.' || (q && c === '?')) && /\s/.test(text[i + 1] ?? ' ')))) {
      out.push(cur)
      cur = ''
    }
  }
  out.push(cur)
  return out.map((x) => x.replace(/[;.]$/, '').trim()).filter(Boolean)
}

const CRITICAL = /(?:,\s*|\s+[—–-]\s+)critical\s*\.?$|\s*\(critical\)\s*\.?$/i
const CRITICAL_FIELD = /\s*\bcritical:\s*(true|yes|false|no)\b(?:\s*\([^)]*\))?\.?/gi
const FOR_FIELD = /\s*\bfor:\s*(product-owner|bauherr)\b\.?/gi
const forOf = (text: string): Decision['for'] => ([...text.matchAll(FOR_FIELD)].at(-1)?.[1]?.toLowerCase() as Decision['for']) ?? undefined
const TITLE_FIELD = /\s*\(\s*critical:\s*(?:true|yes|false|no)\s*\)/gi
const LETTERED = /\s+(?=\(\w\)\s)/
const isCritical = (title: string, body: string): boolean =>
  CRITICAL.test(title) || [...`${title} ${body}`.matchAll(CRITICAL_FIELD)].some((m) => /^(true|yes)$/i.test(m[1]!))

const ROW = /^(?=\s*[-*]\s+\*\*D\d+\b|\s*\|\s*D\d+\s*\|)/m

export const parseDecisions = (plan: string): Decision[] =>
  section(plan, /Decisions\b/).split(ROW).flatMap((b) => {
    const t = /^\s*\|\s*(D\d+)\s*\|(.*)$/m.exec(b)
    if (t) {
      const [question = '', options = '', def = '', why = '', crit = '', who = ''] = t[2]!.split('|').map((c) => c.trim())
      const by = /^(product-owner|bauherr)$/i.test(who) ? (who.toLowerCase() as Decision['for']) : undefined
      return [{ id: t[1]!, title: question, critical: /^(yes|true)\b/i.test(crit), default: def || options.split(' / ')[0]!, options: [def, ...options.split(' / ').filter((o) => o !== def)].filter(Boolean), ...(why && { why }), ...(by && { for: by }) }]
    }
    const m = /^\s*[-*]\s+\*\*(D\d+)(?:\s+(.+?))?\*\*[.:]?\s*([\s\S]*)$/.exec(b)
    if (!m) return []
    const [, id, bold, rest] = m as unknown as [string, string, string | undefined, string]
    let title = bold?.replace(/\.$/, '') ?? ''
    let body = rest.replace(/\s+/g, ' ').trim()
    if (!bold) {
      const [first = '', ...more] = split(body.replace(/^\([^)]*\)\s*/, ''), false, true)
      title = first.replace(/\.$/, '')
      body = more.join('. ')
    }
    const critical = isCritical(title, body)
    const by = forOf(`${title} ${body}`)
    body = body.replace(CRITICAL_FIELD, '').replace(FOR_FIELD, '')
    title = title.replace(TITLE_FIELD, '').replace(CRITICAL_FIELD, '').replace(FOR_FIELD, '')
    const alts = [...body.matchAll(/(?:Alternatives?|Options):\s*(.+?)(?=\s*(?:Alternatives?:|Options:|(?:Recommended\s+default|Default):?\s|Why:)|$)/g)].flatMap((a) => split(a[1]!, true).flatMap((x) => x.split(LETTERED)).flatMap((x) => x.split(' / ')))
    const marked = /\b(?:Recommended\s+default|Default):?\s+(.*?)(?=\s*(?:Alternatives?:|Options:|Why:)|$)/.exec(body)?.[1]
    const why = /\bWhy:\s*(.*?)(?=\s*(?:Alternatives?:|Options:|(?:Recommended\s+default|Default):?\s|critical\b)|$)/i.exec(body)?.[1]?.trim().replace(/\.$/, '')
    const lead = marked ?? /^(.*?)(?=\s*(?:Alternatives?|Options):|$)/.exec(body)![1]!
    const def = (split(lead, false)[0] ?? '').trim()
    const letter = /^\(?(\w)\)?(?!\w)/.exec(def)?.[1]
    const alternatives = alts.filter((a) => !letter || !a.startsWith(`(${letter})`)).map((a) => a.replace(/^\(\w\)\s+/, ''))
    return [{
      id,
      title: title.replace(CRITICAL, '').trim(),
      critical,
      default: def,
      options: [...new Set([def, ...alternatives])],
      ...(why && { why }),
      ...(by && { for: by }),
    }]
  })

export const decisionsSectionHasRows = (plan: string): boolean => /^\s*[-*|]/m.test(section(plan, /Decisions\b/))

export const parseAnswers = (comment: string): Record<string, string> =>
  Object.fromEntries([...comment.matchAll(/^\s*(?:[-*]\s+)?(D\d+):\s*(.+?)\s*$/gm)].map((m) => [m[1]!, m[2]!]))

export const DROPPED = '(no longer needed)'
export const dropLine = (reason: string): string => `${DROPPED} ${reason}`.trim()
export const readAnswer = (a: string): { dropped: boolean; text: string } => (a.startsWith(DROPPED) ? { dropped: true, text: a.slice(DROPPED.length).trim() } : { dropped: false, text: a })

export const formatDecision = (d: Decision): string => {
  const clean = (v: string) => v.replace(/\s+/g, ' ').replace(/;/g, ',').replace(/\?(?=\s)/g, ',').replace(/\.\s/g, ' - ').replace(/\.$/, '').trim()
  const alts = d.options.filter((o) => o !== d.default).map(clean)
  return `- **${d.id}** ${clean(d.title)}${/[?]$/.test(clean(d.title)) ? '' : '?'}${alts.length ? ` Alternatives: ${alts.join('; ')}.` : ''} Default: ${clean(d.default)}.${d.why ? ` Why: ${clean(d.why)}.` : ''} critical: ${d.critical}.${d.for ? ` for: ${d.for}.` : ''}`
}

export const addedOf = (comments: Commentish[]): Decision[] => {
  const c = answersOf(comments)
  return c ? parseDecisions(c.body) : []
}

export const decisionView = (decisions: Decision[], answers: Record<string, string>, { stageKind, approved, fastLane = false }: { stageKind: Kind | undefined; approved: boolean; fastLane?: boolean }): { open: number; answered: number; answerable: number; defaults: Decision[]; takenBy: 'fast lane' | 'at approval' } => {
  const unanswered = decisions.filter((d) => !answers[d.id])
  const sheetOpen = !approved && !fastLane && (stageKind === 'triage' || stageKind === 'plan')
  return { open: unanswered.length, answered: decisions.length - unanswered.length, answerable: sheetOpen ? unanswered.length : 0, defaults: sheetOpen ? [] : unanswered, takenBy: fastLane ? 'fast lane' : 'at approval' }
}

export type FrozenDecision = { id: string; title: string; status: 'answered' | 'default'; answer?: string; default?: string }

export const freezeDecisions = (decisions: Decision[], answers: Record<string, string>): FrozenDecision[] =>
  decisions.map((d) => (answers[d.id] ? { id: d.id, title: d.title, status: 'answered', answer: answers[d.id] } : { id: d.id, title: d.title, status: 'default', default: d.default }))

export const decisionsShown = (frozen: FrozenDecision[] | null | undefined, decisions: Decision[], answers: Record<string, string>, approved: boolean): { decisions: Decision[]; answers: Record<string, string> } =>
  frozen && approved
    ? { decisions: frozen.map((r) => ({ id: r.id, title: r.title, critical: false, default: r.default ?? '', options: [] })), answers: Object.fromEntries(frozen.flatMap((r) => (r.status === 'answered' ? [[r.id, r.answer ?? '']] : []))) }
    : { decisions, answers }

export const fastLaneOf = (t: { expedite?: boolean | null; inheritedApprovalFrom?: unknown }): boolean => !!t.expedite || !!t.inheritedApprovalFrom

export const openDecisionCount = (comments: Commentish[], at: { stageKind: Kind | undefined; approved: boolean; fastLane?: boolean }): number => {
  const sheet = sheetOf(comments)
  if (!sheet) return 0
  const decisions = parseDecisions(sheet.body)
  const answers = parseAnswers(answersOf(comments)?.body ?? '')
  return decisionView(decisions, answers, at).answerable ? unansweredCritical(decisions, answers).length : 0
}

export const decisionsOpen = (comments: Commentish[], at: Parameters<typeof openDecisionCount>[1]): boolean => openDecisionCount(comments, at) > 0

export const unansweredCritical = (decisions: Decision[], answers: Record<string, string>): Decision[] =>
  decisions.filter((d) => d.critical && !answers[d.id])

export const planSummary = (plan: string): { title: string; steps: number } => {
  const body = plan.replace(PLAN_MARKER, '').trim()
  const title = /^#{1,3}\s+(.+)$/m.exec(body)?.[1] ?? body.split('\n')[0] ?? ''
  return { title: title.trim(), steps: (section(plan, /Steps\b/).match(/^\s*\d+\.\s/gm) ?? []).length }
}

export const planFiles = (plan: string): string[] => [
  ...new Set(section(plan, /Files\b/).split('\n').map((l) => l.trim().replace(/^[-*]\s+/, '').replace(/`/g, '').trim()).filter((l) => l && !l.startsWith('#'))),
]

export const goalOf = (plan: string): string => section(plan, /Goal\b/).trim().replace(/\s+/g, ' ')

export type SubTicket = { title: string; body: string; after?: string }

export const subTickets = (plan: string): SubTicket[] =>
  section(plan, /Sub-tickets\b/)
    .split(/^(?=[-*]\s+\*\*)/m)
    .flatMap((item) => {
      const m = /^[-*]\s+\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?([\s\S]*)$/.exec(item.trim())
      const title = m?.[1]?.trim()
      if (!title) return []
      const lines = m![2]!.split('\n').map((l) => l.trim()).filter(Boolean)
      const after = lines.map((l) => /^after:\s*(.+)$/i.exec(l)?.[1]?.trim()).find(Boolean)
      return [{ title, body: lines.filter((l) => !/^after:\s*\S/i.test(l)).join('\n'), ...(after && { after }) }]
    })

export const sheetOf = <T extends Commentish>(comments: T[]): T | undefined => comments.findLast((c) => c.body.startsWith(PLAN_MARKER) || c.body.startsWith(TRIAGE_MARKER))

export const answersOf = <T extends Commentish>(comments: T[]): T | undefined => {
  const sheet = sheetOf(comments)
  return sheet ? latestWith(comments.slice(comments.indexOf(sheet) + 1), DECISIONS_MARKER) : undefined
}

export const openCritical = (comments: Commentish[]): Decision[] => {
  const sheet = sheetOf(comments)
  if (!sheet) return []
  return unansweredCritical(parseDecisions(sheet.body), parseAnswers(answersOf(comments)?.body ?? ''))
}

export const openOwnerRows = (comments: Commentish[]): number => {
  const sheet = sheetOf(comments)
  const answers = parseAnswers(answersOf(comments)?.body ?? '')
  return sheet ? [...parseDecisions(sheet.body), ...addedOf(comments)].filter((d) => d.for === 'product-owner' && !answers[d.id]).length : 0
}

export const unansweredCriticalCount = (comments: Commentish[]): number => openCritical(comments).length

export const withoutDecisions = (plan: string): string => plan.replace(/^##\s+Decisions\b.*$[\s\S]*?(?=^##\s|(?![\s\S]))/im, '')

export const withoutWorklogHeading = (md: string): string => md.replace(/^\s*##\s+Worklog\s*\n/i, '')
