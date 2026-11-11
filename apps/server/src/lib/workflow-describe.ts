import { stagesOf, type Doc } from './workflow-edit'
import { modelText, pathLabel, SPECIAL_TARGET, stageTitle } from './workflow-labels'
import type { Kind } from './workflow-rules'

// Browser-safe. Plain-word list of what differs between two factory documents (Review changes and History).

const roles = (d: Doc): Doc => d?.team?.roles ?? {}
const roleTitle = (d: Doc, id: unknown): string => roles(d)[String(id)]?.title ?? String(id)
const limit = (n: unknown): string => (typeof n === 'number' ? String(n) : 'no limit')
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
/** The step before `name` in the flow (containers skipped). */
const before = (list: Doc[], name: string): Doc | undefined => {
  let i = list.findIndex((s) => s.name === name) - 1
  while (list[i]?.kind === 'container') i--
  return list[i]
}

/** What changes from `a` to `b`, one plain line each, in flow order. Empty when nothing visible differs. */
export const describeChanges = (a: Doc, b: Doc): string[] => {
  const out: string[] = []
  const sa = stagesOf(a)
  const sb = stagesOf(b)
  const A = new Map(sa.map((s) => [String(s.name), s]))
  const B = new Map(sb.map((s) => [String(s.name), s]))
  const target = (d: Doc, t: unknown) => SPECIAL_TARGET[String(t)] ?? stageTitle(stagesOf(d).find((s) => s.name === t) ?? { name: t })
  const splitBefore = sa.some((s) => s.kind === 'container')
  const splitAfter = sb.some((s) => s.kind === 'container')

  for (const s of sa) if (!B.has(s.name) && s.kind !== 'container') out.push(`Removed step ${stageTitle(s)}`)
  for (const s of sb) {
    if (A.has(s.name) || s.kind === 'container') continue
    const prev = before(sb, s.name)
    const where = prev ? ` after ${stageTitle(prev)}` : ''
    out.push(s.kind === 'human' ? `New decision for you: ${stageTitle(s)}${where}` : `New step ${stageTitle(s)}${where}${s.role ? `, worked by ${roleTitle(b, s.role)}` : ''}`)
  }
  if (!splitBefore && splitAfter) out.push('Plan: large tickets can now be split into sub-tickets')
  if (splitBefore && !splitAfter) out.push('Plan: large tickets can no longer be split into sub-tickets')

  const common = sb.filter((s) => A.has(s.name))
  const prevOf = (list: Doc[], n: string) => before(list.filter((s) => A.has(s.name) && B.has(s.name)), n)?.name
  for (const y of common) {
    const x = A.get(y.name)!
    const t = stageTitle(y)
    const kind = y.kind as Kind
    if (stageTitle(x) !== t) out.push(`Step renamed: ${stageTitle(x)} → ${t}`)
    if (x.role !== y.role) out.push(`${t}: now worked by ${y.role ? roleTitle(b, y.role) : 'no agent'}`)
    if (x.skill !== y.skill) out.push(`${t}: now follows the skill ${y.skill ?? 'none'}`)
    if (x.wip !== y.wip) out.push(`${t}: at most ${limit(x.wip)} → ${limit(y.wip)} tickets at a time`)
    if (x.gate !== y.gate) out.push(`${t}: you are ${y.gate ? 'now' : 'no longer'} asked to ${kind === 'plan' ? 'approve the plan' : 'accept the result on staging'}`)
    if (x.production_gate !== y.production_gate) out.push(`${t}: you are ${y.production_gate ? 'now' : 'no longer'} asked to approve production`)
    if (!same(x.exclude_labels, y.exclude_labels)) out.push(`${t}: the labels that keep a ticket out of the factory changed`)
    for (const key of new Set([...Object.keys(x.outcomes ?? {}), ...Object.keys(y.outcomes ?? {})])) {
      const from = x.outcomes?.[key]
      const to = y.outcomes?.[key]
      if (from === to || (key === 'split' && splitBefore !== splitAfter)) continue
      if ((B.has(to) && !A.has(to)) || (A.has(from) && !B.has(from))) continue // the path only follows a step that was added or removed
      const when = pathLabel(kind, key).toLowerCase()
      out.push(from === undefined ? `${t}: new path when ${when}, goes to ${target(b, to)}` : to === undefined ? `${t}: path when ${when} removed` : `${t}: when ${when}, now goes to ${target(b, to)} instead of ${target(a, from)}`)
    }
    const p = prevOf(sb, y.name)
    if (p !== prevOf(sa, y.name) && p !== undefined) out.push(`Step moved: ${t} now comes after ${target(b, p)}`)
  }

  const ra = roles(a)
  const rb = roles(b)
  for (const [id, r] of Object.entries(ra)) if (!(id in rb)) out.push(`Removed agent ${(r as Doc).title ?? id}`)
  for (const [id, r] of Object.entries(rb) as [string, Doc][]) {
    const o = ra[id] as Doc | undefined
    if (!o) {
      out.push(`New agent ${r.title ?? id}`)
      continue
    }
    if (o.title !== r.title) out.push(`Agent renamed: ${o.title} → ${r.title}`)
    if (modelText(o) !== modelText(r)) out.push(`${r.title}: model ${modelText(o)} → ${modelText(r)}`)
    if (o.agents !== r.agents) out.push(`${r.title}: up to ${limit(o.agents)} → ${limit(r.agents)} at once`)
    if (!same(o.skills, r.skills) || o.profile !== r.profile || o.profile_file !== r.profile_file) out.push(`${r.title}: profile changed`)
  }
  for (const [from, to] of Object.entries((b?.workflow?.migrate ?? {}) as Doc)) if (a?.workflow?.migrate?.[from] !== to) out.push(`Tickets in ${target(a, from)} move to ${target(b, to)}`)
  return out
}
