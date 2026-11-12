import { parse } from 'yaml'
import { asList, REQUEST_TYPES, SET_NAME, WHEN_KEYS, type When } from './workflow-when'

// Browser-safe: no node: imports. The pure half of workflow.ts (types, kind rules, lint); workflow.ts re-exports it.
export type Kind = 'triage' | 'plan' | 'container' | 'build' | 'review' | 'release' | 'done' | 'agent' | 'human'
/** Who a checkpoint asks. `gate: human` is `{by: bauherr}`; a Bauherr or Admin can always step in for the Product owner. */
export const ADDRESSEES = ['bauherr', 'product-owner'] as const
export type Addressee = (typeof ADDRESSEES)[number]
export type StageDef = { name: string; title: string; kind: Kind; role?: string; skill?: string; mode?: 'session' | 'autonomous'; gate?: 'human'; /** Compiled `gate: {by}`; absent = bauherr. */ gate_by?: Addressee; production_gate?: 'human'; production_gate_by?: Addressee; /** Triage's questions (`refine: {by}` on the triage stage); absent = bauherr. */ refine_by?: Addressee; /** Who decides a `human` stage; absent = bauherr. */ by?: Addressee; wip?: number; exclude_labels?: string[]; /** A step of kind agent or human that runs only when the change matches; otherwise the Ticket moves on (see `skipTarget`). */ when?: When; skip_to?: string; outcomes: Record<string, string>; /** The outcome keys in the order the file lists them (jsonb does not keep object key order); the buttons of a `human` stage and the outcome lists of an `agent` stage follow it. */ outcomeOrder?: string[] }
export type Role = { id: string; title: string; tier?: 'cheap' | 'standard' | 'strong'; provider?: string; model?: string; agents?: number; avatar?: string; skills?: string[]; exceptions?: boolean; profile?: string; profile_file?: string }
/** Plain JSON: safe to pass to client components. */
export type Workflow = { version: 1; roles: Role[]; stages: StageDef[]; aliases: Record<string, string> }

export const KINDS: Kind[] = ['triage', 'plan', 'container', 'build', 'review', 'release', 'done', 'agent', 'human']
export const RESERVED = ['checks', 'scan', 'distill', 'escalate', 'backlog']
export const OUTCOMES: Partial<Record<Kind, { all: string[]; optional?: string[] }>> = {
  triage: { all: ['plan', 'refine', 'skip'] },
  plan: { all: ['done', 'decisions'], optional: ['split'] },
  container: { all: ['children_done'] },
  build: { all: ['done', 'stuck', 'replan'] },
  review: { all: ['clean', 'changes', 'stop'] },
  release: { all: ['accepted', 'changes'] },
  done: { all: [] },
}
export const NEEDS_ROLE: Kind[] = ['triage', 'plan', 'build', 'review', 'agent']
export const NO_ROLE: Kind[] = ['container', 'release', 'done', 'human']
export const WIP: Kind[] = ['plan', 'build', 'review', 'release', 'agent', 'human']
export const IN_FLIGHT: Kind[] = ['plan', 'build', 'review', 'release', 'agent', 'human']
export const LIVE: Kind[] = ['plan', 'build', 'review', 'agent']

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const posInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0
const addressee = (v: unknown): v is Addressee => (ADDRESSEES as readonly unknown[]).includes(v)
/** `human` or `{by: <addressee>}` (nothing else in the map): who the checkpoint asks; undefined when the value is neither. */
export const askedBy = (v: unknown): Addressee | undefined => {
  const m = obj(v)
  return v === 'human' ? 'bauherr' : m && Object.keys(m).length === 1 && addressee(m.by) ? m.by : undefined
}

/** Where a Ticket goes when the conditional step `s` does not match: `skip_to`, else the target of its first outcome in file order (`outcomeOrder` once compiled). */
export const skipTarget = (s: { outcomes?: Record<string, string>; outcomeOrder?: string[]; skip_to?: string }): string | undefined => s.skip_to ?? s.outcomes?.[(s.outcomeOrder ?? Object.keys(s.outcomes ?? {}))[0] as string]

export const parseFactory = (yaml: string): unknown => parse(yaml)

/** Findings of a factory document; empty = valid. */
export const lint = (doc: unknown): string[] => {
  const out: string[] = []
  const d = obj(doc)
  if (!d) return ['factory file must be a mapping']
  if (d.version !== 1) out.push('version must be 1')
  const roles = obj(obj(d.team)?.roles) ?? {}
  for (const [id, r] of Object.entries(roles)) {
    const x = obj(r) ?? {}
    if (typeof x.title !== 'string' || !x.title) out.push(`role "${id}": title is required`)
    if (!(x.tier ? !x.provider && !x.model : !!x.provider && !!x.model)) out.push(`role "${id}": declare exactly one of tier or (provider and model)`)
    if (x.agents !== undefined && !posInt(x.agents)) out.push(`role "${id}": agents must be a positive integer`)
    if (x.avatar !== undefined && (typeof x.avatar !== 'string' || !x.avatar)) out.push(`role "${id}": avatar must be a non-empty string`)
    if (x.skills !== undefined && !(Array.isArray(x.skills) && x.skills.length >= 1 && x.skills.length <= 6 && x.skills.every((k: unknown) => typeof k === 'string' && k.length >= 1 && k.length <= 24))) out.push(`role "${id}": skills must be a list of 1 to 6 strings of at most 24 characters`)
    if (x.exceptions !== undefined && typeof x.exceptions !== 'boolean') out.push(`role "${id}": exceptions must be true or false`)
  }
  const handlers = Object.entries(roles).filter(([, r]) => obj(r)?.exceptions === true).map(([id]) => id)
  if (handlers.length > 1) out.push(`at most one role may have exceptions: true (found ${handlers.join(', ')})`)
  const raw = obj(d.workflow)?.stages
  if (!Array.isArray(raw) || !raw.length) return [...out, 'workflow.stages must be a non-empty list']
  const st = raw.map((s) => obj(s) ?? {})
  const names = st.map((s) => String(s.name))
  const kindOf = (s: Record<string, any>) => s.kind as Kind
  st.forEach((s, i) => {
    const n = names[i]
    if (!/^[a-z][a-z0-9-]*$/.test(n)) out.push(`stage "${n}": name must match ^[a-z][a-z0-9-]*$`)
    else if (RESERVED.includes(n)) out.push(`stage "${n}": name is reserved`)
    if (names.indexOf(n) !== i) out.push(`stage "${n}": duplicate name`)
    if (!KINDS.includes(kindOf(s))) out.push(`stage "${n}": unknown kind "${s.kind}"`)
  })
  const of = (k: Kind) => st.filter((s) => kindOf(s) === k)
  if (of('triage').length !== 1 || kindOf(st[0]) !== 'triage') out.push('exactly one triage stage, and it must be first')
  if (of('done').length !== 1 || kindOf(st[st.length - 1]) !== 'done') out.push('exactly one done stage, and it must be last')
  for (const k of ['plan', 'container', 'build', 'review', 'release'] as Kind[]) if (of(k).length > 1) out.push(`at most one ${k} stage`)
  const [plan, container, build, review, release, done] = (['plan', 'container', 'build', 'review', 'release', 'done'] as Kind[]).map((k) => of(k)[0])
  if (!!container !== !!obj(plan?.outcomes)?.split) out.push('a container stage exists if and only if the plan stage has a split outcome')
  if (new Set([!!build, !!review, !!release]).size > 1) out.push('build, review and release stages are all present or all absent')
  else if (build && review && release && done) {
    const want = (s: Record<string, any>, key: string, to: Record<string, any>) => {
      if (obj(s.outcomes)?.[key] !== to.name) out.push(`stage "${s.name}": outcome ${key} must target "${to.name}"`)
    }
    want(review, 'changes', build)
    want(review, 'clean', release)
    want(release, 'accepted', done)
    want(release, 'changes', build)
    const through = (n: string, seen = new Set<string>()): boolean => {
      if (n === review.name) return true
      const s = st.find((x) => x.name === n)
      if (seen.has(n) || !s || !['agent', 'human'].includes(kindOf(s))) return false
      seen.add(n)
      return [...Object.values(obj(s.outcomes) ?? {}), ...(s.when ? [skipTarget(s as never)] : [])].some((t) => through(String(t), seen))
    }
    if (!through(String(obj(build.outcomes)?.done))) out.push(`stage "${build.name}": outcome done must lead to the review stage "${review.name}", passing only through agent and human stages`)
    for (const s of st) if (s !== review && Object.values(obj(s.outcomes) ?? {}).includes(release.name)) out.push(`stage "${s.name}": only the review stage may target the release stage "${release.name}"`)
  }
  const wf = obj(d.workflow)
  const nameOk = (n: string) => /^[a-z][a-z0-9-]*$/.test(n)
  for (const key of ['migrate', 'aliases'] as const) {
    if (wf?.[key] === undefined) continue
    const m = obj(wf[key])
    if (!m) out.push(`workflow.${key} must be a mapping of old stage names to current stage names`)
    else
      for (const [old, to] of Object.entries(m)) {
        if (!nameOk(old)) out.push(`workflow.${key}: "${old}" is not a stage name`)
        else if (names.includes(old)) out.push(`workflow.${key}: "${old}" is a current stage`)
        if (!names.includes(String(to))) out.push(`workflow.${key}: "${old}" maps to unknown stage "${to}"`)
      }
  }
  const targets = new Set([...names, 'escalate', 'backlog'])
  const edges: [string, string][] = []
  st.forEach((s) => {
    const n = s.name
    const k = kindOf(s)
    const o = obj(s.outcomes)
    const keys = Object.keys(o ?? {})
    const rule = OUTCOMES[k]
    if (rule) {
      const missing = rule.all.filter((x) => !keys.includes(x))
      const extra = keys.filter((x) => !rule.all.includes(x) && !rule.optional?.includes(x))
      if (missing.length || extra.length) out.push(`stage "${n}" (${k}): outcomes must be ${[...rule.all, ...(rule.optional ?? []).map((x) => `${x}?`)].join(', ') || 'none'}${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; unexpected ${extra.join(', ')}` : ''}`)
    } else if (KINDS.includes(k) && !keys.length) out.push(`stage "${n}" (${k}): declare at least one outcome`)
    for (const [key, to] of Object.entries(o ?? {})) {
      if (!targets.has(String(to))) out.push(`stage "${n}": outcome ${key} targets unknown stage "${to}"`)
      else if (names.includes(String(to))) edges.push([n, String(to)])
    }
    if (s.role !== undefined && !(s.role in roles)) out.push(`stage "${n}": role "${s.role}" is not in team.roles`)
    else if (NEEDS_ROLE.includes(k) && !s.role) out.push(`stage "${n}" (${k}): role is required`)
    if (k === 'agent' && !s.skill) out.push(`stage "${n}" (agent): skill is required`)
    if (k === 'human' && (keys.length > 4 || keys.some((x) => !/^[a-z][a-z0-9_-]*$/.test(x)))) out.push(`stage "${n}" (human): 1 to 4 outcome keys matching ^[a-z][a-z0-9_-]*$`)
    if (NO_ROLE.includes(k) && s.role) out.push(`stage "${n}" (${k}): role is not allowed`)
    if (s.gate !== undefined && !(k === 'plan' || k === 'release')) out.push(`stage "${n}": gate: human is only allowed on the plan and release stages`)
    else if (s.gate !== undefined && !askedBy(s.gate)) out.push(`stage "${n}": gate must be human or {by: bauherr | product-owner}`)
    if (s.production_gate !== undefined && k !== 'release') out.push(`stage "${n}": production_gate: human is only allowed on the release stage`)
    else if (s.production_gate !== undefined && !askedBy(s.production_gate)) out.push(`stage "${n}": production_gate must be human or {by: bauherr | product-owner}`)
    if (s.refine !== undefined && !(k === 'triage' && obj(s.refine) && Object.keys(s.refine).length === 1 && addressee(s.refine.by))) out.push(`stage "${n}": refine: {by: bauherr | product-owner} is only allowed on the triage stage`)
    if (s.by !== undefined && !(k === 'human' && addressee(s.by))) out.push(`stage "${n}": by: bauherr | product-owner is only allowed on a human stage`)
    if (s.wip !== undefined && !(posInt(s.wip) && WIP.includes(k))) out.push(`stage "${n}": wip must be a positive integer on a plan, build, review, release, agent or human stage`)
    if (s.when !== undefined) {
      const w = obj(s.when)
      const bad = (m: string) => out.push(`stage "${n}": when ${m}`)
      const list = (v: unknown, ok: (x: unknown) => boolean = (x) => typeof x === 'string' && x !== '') => Array.isArray(v) && v.length > 0 && v.every(ok)
      if (k !== 'agent' && k !== 'human') bad('is only allowed on agent and human stages')
      else if (!w || !Object.keys(w).length) bad('must name at least one of touches, paths, labels, types')
      else {
        for (const key of Object.keys(w)) if (!(WHEN_KEYS as readonly string[]).includes(key)) bad(`has an unknown key "${key}" (use touches, paths, labels or types)`)
        if (w.touches !== undefined && !(list(asList(w.touches), (x) => typeof x === 'string' && SET_NAME.test(x)) && (typeof w.touches === 'string' || Array.isArray(w.touches)))) bad('touches must be a path set name or a list of names matching ^[a-z][a-z0-9-]*$')
        if (w.paths !== undefined && !list(w.paths)) bad('paths must be a non-empty list of path globs')
        if (w.labels !== undefined && !list(w.labels)) bad('labels must be a non-empty list of labels')
        if (w.types !== undefined && !list(w.types, (x) => (REQUEST_TYPES as readonly string[]).includes(x as string))) bad(`types must be a non-empty list of ${REQUEST_TYPES.join(', ')}`)
      }
      const skip = skipTarget(s as never)
      const to = st.find((x) => x.name === skip)
      if (!to) out.push(`stage "${n}": the step it skips to ("${skip}") must be a stage`)
      else {
        if (['triage', 'container', 'release', 'done'].includes(kindOf(to))) out.push(`stage "${n}": a skipped ticket cannot go to the ${kindOf(to)} stage "${skip}"`)
        else if (skip === n) out.push(`stage "${n}": a skipped ticket cannot stay in the stage`)
        if (s.skip_to !== undefined) edges.push([n, String(skip)])
      }
    } else if (s.skip_to !== undefined) out.push(`stage "${n}": skip_to needs a when`)
    if (s.mode !== undefined && s.mode !== 'session' && s.mode !== 'autonomous') out.push(`stage "${n}": mode must be session or autonomous`)
  })
  for (const s of st) {
    const chain = [String(s.name)]
    for (let x = s; x.when; ) {
      const next = st.find((y) => y.name === skipTarget(x as never))
      if (!next || !next.when) break
      if (chain.includes(String(next.name))) {
        out.push(`stage "${s.name}": conditional stages skip in a cycle (${[...chain, next.name].join(' -> ')})`)
        break
      }
      chain.push(String(next.name))
      x = next
    }
  }
  const reach = (from: string, pairs: [string, string][]) => {
    const seen = new Set([from])
    for (let grew = true; grew; ) {
      grew = false
      for (const [a, b] of pairs) if (seen.has(a) && !seen.has(b)) (seen.add(b), (grew = true))
    }
    return seen
  }
  const first = of('triage')[0]
  if (first && done) {
    const fwd = reach(first.name, edges)
    const back = reach(done.name, edges.map(([a, b]) => [b, a]))
    for (const n of names) {
      if (!fwd.has(n)) out.push(`stage "${n}" is not reachable from the triage stage`)
      if (!back.has(n)) out.push(`stage "${n}" cannot reach the done stage`)
    }
  }
  return out
}
