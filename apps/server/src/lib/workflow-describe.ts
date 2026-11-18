import { stagesOf, type Doc } from './workflow-edit'
import { ASKED, modelText, pathLabel, SPECIAL_TARGET, stageTitle } from './workflow-labels'
import { askedBy, type Kind } from './workflow-rules'
import { whenClause } from './workflow-when'

const roles = (d: Doc): Doc => d?.team?.roles ?? {}
const roleTitle = (d: Doc, id: unknown): string => roles(d)[String(id)]?.title ?? String(id)
const limit = (n: unknown): string => (typeof n === 'number' ? String(n) : 'no limit')
const gateOf = (s: Doc): unknown => s.gate ?? ((j) => j && { by: j.by ?? 'bauherr' })(s.jobs?.find((x: Doc) => x?.kind === 'human'))
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const before = (list: Doc[], name: string): Doc | undefined => {
  let i = list.findIndex((s) => s.name === name) - 1
  while (list[i]?.kind === 'container') i--
  return list[i]
}

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
    out.push(s.kind === 'human' ? `New decision for you: ${stageTitle(s)}${where}` : `New step ${stageTitle(s)}${where}${s.role ? `, worked by ${roleTitle(b, s.role)}` : ''}${s.when ? `, only ${whenClause(s.when)}` : ''}`)
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
    if (!same(x.when, y.when)) out.push(y.when ? `${t} now runs only ${whenClause(y.when)}` : `${t} now runs for every ticket`)
    if (x.skill !== y.skill) out.push(`${t}: now follows the skill ${y.skill ?? 'none'}`)
    if (x.wip !== y.wip) out.push(`${t}: at most ${limit(x.wip)} → ${limit(y.wip)} tickets at a time`)
    if (!!askedBy(gateOf(x)) !== !!askedBy(gateOf(y))) out.push(`${t}: you are ${gateOf(y) ? 'now' : 'no longer'} asked to ${kind === 'plan' ? 'approve the plan' : 'accept the result on staging'}`)
    if (!!askedBy(x.production_gate) !== !!askedBy(y.production_gate)) out.push(`${t}: you are ${y.production_gate ? 'now' : 'no longer'} asked to approve production`)
    const who = (what: string, a: unknown, b: unknown) => {
      if (a !== undefined && b !== undefined && askedBy(a) !== askedBy(b)) out.push(`${t}: ${what} is now asked of the ${ASKED[askedBy(b) ?? 'bauherr']} instead of the ${ASKED[askedBy(a) ?? 'bauherr']}`)
    }
    who(kind === 'plan' ? 'approving the plan' : 'accepting the result on staging', gateOf(x), gateOf(y))
    who('approving production', x.production_gate, y.production_gate)
    who('answering open questions', x.refine ?? { by: 'bauherr' }, y.refine ?? { by: 'bauherr' })
    if (kind === 'human' && askedBy({ by: x.by }) !== askedBy({ by: y.by })) out.push(`${t}: the decision is now asked of the ${ASKED[askedBy({ by: y.by }) ?? 'bauherr']} instead of the ${ASKED[askedBy({ by: x.by }) ?? 'bauherr']}`)
    const ja = new Map<string, Doc>((x.jobs ?? []).filter((j: Doc) => j?.kind !== 'human').map((j: Doc) => [String(j.id), j]))
    const jb = new Map<string, Doc>((y.jobs ?? []).filter((j: Doc) => j?.kind !== 'human').map((j: Doc) => [String(j.id), j]))
    for (const [id, j] of jb) {
      const o = ja.get(id)
      if (!o) out.push(`${t}: new job ${id}${j.role ? `, worked by ${roleTitle(b, j.role)}` : ''}${j.when ? `, only ${whenClause(j.when)}` : ''}${j.blocking === false ? ', does not block' : ''}`)
      else if (id !== y.name && !same(o, j)) {
        if (o.role !== j.role) out.push(`${t}: job ${id} is now worked by ${j.role ? roleTitle(b, j.role) : 'no agent'}`)
        if (!same(o.when, j.when)) out.push(j.when ? `${t}: job ${id} now runs only ${whenClause(j.when)}` : `${t}: job ${id} now runs for every ticket`)
        if ((o.blocking ?? true) !== (j.blocking ?? true)) out.push(`${t}: job ${id} ${j.blocking === false ? 'no longer blocks' : 'now blocks'} the step`)
        if (!same({ ...o, role: 0, when: 0, blocking: 0 }, { ...j, role: 0, when: 0, blocking: 0 })) out.push(`${t}: job ${id} changed`)
      }
    }
    for (const id of ja.keys()) if (!jb.has(id)) out.push(`${t}: job ${id} removed`)
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
