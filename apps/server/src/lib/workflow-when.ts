// Browser-safe. Conditional stages: the `when` of a stage, whether it matches a change, and its plain words.

export const REQUEST_TYPES = ['bug', 'feature', 'change', 'question'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]
/** A Ticket carries its request type as the label `bauherr:type:<kind>`. */
export const TYPE_LABEL = 'bauherr:type:'
export const SET_NAME = /^[a-z][a-z0-9-]*$/
/** The two path-set names a Product is offered to declare. */
export const SUGGESTED_SETS = ['security', 'ui'] as const
export const WHEN_KEYS = ['touches', 'paths', 'labels', 'types'] as const

export type When = { touches?: string | string[]; paths?: string[]; labels?: string[]; types?: string[] }
/** What a condition is judged by: the changed paths (null = not known), the Ticket's labels, the Product's named path sets. */
export type Facts = { paths: string[] | null; labels: string[]; sets: Record<string, string[]> }
export type Verdict = { match: true } | { match: false; reason: string }

export const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : [])
export const typeOf = (labels: string[]): string | null => labels.find((l) => l.startsWith(TYPE_LABEL))?.slice(TYPE_LABEL.length) ?? null
const A = (t: string) => `a ${t}`
const or = (l: string[]) => l.join(' or ')

/** Whether `when` matches the facts. Keys are AND-ed, values of a key OR-ed; unknown changed paths match (the review happens rather than being skipped silently); a path set the Product has not declared (or left empty) never matches. */
export const evalWhen = (when: When, facts: Facts, glob: (g: string, p: string) => boolean): Verdict => {
  const no = (reason: string): Verdict => ({ match: false, reason })
  const touches = asList(when.touches)
  if (touches.length) {
    const declared = touches.filter((n) => facts.sets[n]?.length)
    if (!declared.length) return no(`the Product declares no ${or(touches)} paths`)
    if (facts.paths && !facts.paths.some((p) => declared.some((n) => facts.sets[n]!.some((g) => glob(g, p))))) return no(`the change touches no ${or(touches)} paths`)
  }
  if (when.paths?.length && facts.paths && !facts.paths.some((p) => when.paths!.some((g) => glob(g, p)))) return no(`the change touches none of ${when.paths.join(', ')}`)
  if (when.labels?.length && !when.labels.some((l) => facts.labels.includes(l))) return no(`the ticket has none of the labels ${when.labels.join(', ')}`)
  if (when.types?.length) {
    const t = typeOf(facts.labels)
    if (!t || !when.types.includes(t)) return no(t ? `the request is not ${or(when.types.map(A))}` : `the request is not marked as ${or(when.types.map(A))}`)
  }
  return { match: true }
}

/** The condition of a step in plain words: "when the change touches security paths", "for bugs". */
export const whenClause = (when: When): string => {
  const c: string[] = []
  const touches = asList(when.touches)
  if (touches.length) c.push(`the change touches ${or(touches.map((n) => `${n} paths`))}`)
  if (when.paths?.length) c.push(`the change touches ${or(when.paths)}`)
  if (when.labels?.length) c.push(`the ticket has the label ${or(when.labels)}`)
  if (when.types?.length) {
    if (!c.length) return `for ${or(when.types.map((t) => `${t}s`))}`
    c.push(`the request is ${or(when.types.map(A))}`)
  }
  return `when ${c.join(' and ')}`
}

/** The chip of a conditional step: "Only when the change touches security paths", "Only for bugs". */
export const whenText = (when: When): string => `Only ${whenClause(when)}`
