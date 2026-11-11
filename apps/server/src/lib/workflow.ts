import { readFileSync } from 'node:fs'
import { GRAPH_CHECKPOINT } from './checkpoints'
import { resolve } from 'node:path'
import { parse } from 'yaml'

export type Kind = 'triage' | 'plan' | 'container' | 'build' | 'review' | 'release' | 'done' | 'agent' | 'human'
export type StageDef = { name: string; title: string; kind: Kind; role?: string; skill?: string; mode?: 'session' | 'autonomous'; gate?: 'human'; production_gate?: 'human'; wip?: number; exclude_labels?: string[]; outcomes: Record<string, string>; /** The outcome keys in the order the file lists them (jsonb does not keep object key order); the buttons of a `human` stage and the outcome lists of an `agent` stage follow it. */ outcomeOrder?: string[] }
export type Role = { id: string; title: string; tier?: 'cheap' | 'standard' | 'strong'; provider?: string; model?: string; agents?: number; avatar?: string; skills?: string[]; exceptions?: boolean; profile?: string; profile_file?: string }
/** Plain JSON: safe to pass to client components. */
export type Workflow = { version: 1; roles: Role[]; stages: StageDef[]; aliases: Record<string, string> }
export type Graph = { nodes: { id: string; title: string; kind: Kind; role?: string; checkpoint: boolean }[]; edges: { from: string; to: string; outcome: string; back: boolean }[] }

const KINDS: Kind[] = ['triage', 'plan', 'container', 'build', 'review', 'release', 'done', 'agent', 'human']
const RESERVED = ['checks', 'scan', 'distill', 'escalate', 'backlog']
const OUTCOMES: Partial<Record<Kind, { all: string[]; optional?: string[] }>> = {
  triage: { all: ['plan', 'refine', 'skip'] },
  plan: { all: ['done', 'decisions'], optional: ['split'] },
  container: { all: ['children_done'] },
  build: { all: ['done', 'stuck', 'replan'] },
  review: { all: ['clean', 'changes', 'stop'] },
  release: { all: ['accepted', 'changes'] },
  done: { all: [] },
}
const NEEDS_ROLE: Kind[] = ['triage', 'plan', 'build', 'review', 'agent']
const NO_ROLE: Kind[] = ['container', 'release', 'done', 'human']
const WIP: Kind[] = ['plan', 'build', 'review', 'release', 'agent', 'human']
const IN_FLIGHT: Kind[] = ['plan', 'build', 'review', 'release', 'agent', 'human']
const LIVE: Kind[] = ['plan', 'build', 'review', 'agent']

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const posInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0

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
      return Object.values(obj(s.outcomes) ?? {}).some((t) => through(String(t), seen))
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
    if (s.gate !== undefined && !(s.gate === 'human' && (k === 'plan' || k === 'release'))) out.push(`stage "${n}": gate: human is only allowed on the plan and release stages`)
    if (s.production_gate !== undefined && !(s.production_gate === 'human' && k === 'release')) out.push(`stage "${n}": production_gate: human is only allowed on the release stage`)
    if (s.wip !== undefined && !(posInt(s.wip) && WIP.includes(k))) out.push(`stage "${n}": wip must be a positive integer on a plan, build, review, release, agent or human stage`)
    if (s.mode !== undefined && s.mode !== 'session' && s.mode !== 'autonomous') out.push(`stage "${n}": mode must be session or autonomous`)
  })
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

/** Throws one Error listing every lint finding. */
export const compile = (doc: unknown): Workflow => {
  const findings = lint(doc)
  if (findings.length) throw new Error(`invalid factory file:\n- ${findings.join('\n- ')}`)
  const d = doc as Record<string, any>
  return {
    version: 1,
    roles: Object.entries(d.team.roles as Record<string, Omit<Role, 'id'>>).map(([id, r]) => ({ id, ...r })),
    stages: (d.workflow.stages as Partial<StageDef>[]).map((s) => ({ ...s, title: s.title ?? (s.name ?? '').charAt(0).toUpperCase() + (s.name ?? '').slice(1), outcomes: s.outcomes ?? {}, ...((s.kind === 'human' || s.kind === 'agent') && { outcomeOrder: Object.keys(s.outcomes ?? {}) }) }) as StageDef),
    aliases: d.workflow.aliases ?? {},
  }
}

export const packDir = () => process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')
let cached: { path: string; wf: Workflow } | undefined

export const corePack = () => resolve(process.cwd(), '../../pack')

/** The workflow of `factory.yaml` in the pack dir, compiled once per path. A pack dir without the file (an overlay that only adds rules or skills) uses the core pack's; throws on first use when neither is readable or the file is invalid. */
export const DEFAULT = (): Workflow => {
  const path = resolve(packDir(), 'factory.yaml')
  if (cached?.path !== path) {
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      const core = resolve(corePack(), 'factory.yaml')
      try {
        text = readFileSync(core, 'utf8')
      } catch (e) {
        throw new Error(`cannot read ${path} or ${core}: ${(e as Error).message}`)
      }
    }
    cached = { path, wf: compile(parseFactory(text)) }
  }
  return cached.wf
}

export const stage = (wf: Workflow, name: string): StageDef | undefined => {
  const n = wf.aliases[name] ?? name
  return wf.stages.find((s) => s.name === n)
}
export const byKind = (wf: Workflow, kind: Kind): StageDef | undefined => wf.stages.find((s) => s.kind === kind)
/** The name of the stage of a built-in kind; throws when the workflow has none. */
export const nameOf = (wf: Workflow, kind: Kind): string => {
  const s = byKind(wf, kind)
  if (!s) throw new Error(`the workflow has no ${kind} stage`)
  return s.name
}
export const kindOf = (wf: Workflow, name: string): Kind | undefined => stage(wf, name)?.kind
export const is = (wf: Workflow, name: string, ...kinds: Kind[]): boolean => kinds.includes(kindOf(wf, name) as Kind)
export const title = (wf: Workflow, name: string): string => stage(wf, name)?.title ?? name
export const roleOf = (wf: Workflow, name: string): Role | undefined => wf.roles.find((r) => r.id === stage(wf, name)?.role)
export const stagesOfRole = (wf: Workflow, roleId: string): string[] => wf.stages.filter((s) => s.role === roleId).map((s) => s.name)
export const target = (wf: Workflow, from: string, outcome: string): string | undefined => stage(wf, from)?.outcomes[outcome]

const named = (wf: Workflow, ...kinds: Kind[]) => wf.stages.filter((s) => kinds.includes(s.kind)).map((s) => s.name)
export const order = (wf: Workflow): string[] => wf.stages.map((s) => s.name)
export const isForward = (wf: Workflow, from: string, to: string): boolean => {
  const o = order(wf)
  return o.includes(from) && o.includes(to) && o.indexOf(to) > o.indexOf(from)
}
export const board = (wf: Workflow): string[] => wf.stages.filter((s) => s.kind !== 'container').map((s) => s.name)
export const pullRank = (wf: Workflow): string[] => board(wf).filter((n) => kindOf(wf, n) !== 'done').reverse()
export const wipStages = (wf: Workflow): string[] => named(wf, ...WIP)
export const defaultWip = (wf: Workflow): Record<string, number> => Object.fromEntries(wf.stages.filter((s) => s.wip).map((s) => [s.name, s.wip as number]))
export const heldStages = (wf: Workflow): string[] => wf.stages.filter((s) => WIP.includes(s.kind) && s.kind !== 'release').map((s) => s.name).reverse()
/** Stages whose Run mode a Workspace overrides (Settings > Factory > Models & budget). */
export const modeStages = (wf: Workflow): string[] => named(wf, 'plan', 'build')
export const liveStages = (wf: Workflow): string[] => named(wf, ...LIVE)
export const inFlight = (wf: Workflow): string[] => named(wf, ...IN_FLIGHT)
export const repairable = (wf: Workflow): string[] => wf.stages.filter((s) => s.kind !== 'container' && s.kind !== 'done').map((s) => s.name)
export const gates = (wf: Workflow): { plan: boolean; staging: boolean; production: boolean } => ({
  plan: byKind(wf, 'plan')?.gate === 'human',
  staging: byKind(wf, 'release')?.gate === 'human',
  production: byKind(wf, 'release')?.production_gate === 'human',
})
export const excludeLabels = (wf: Workflow): string[] => byKind(wf, 'triage')?.exclude_labels ?? []

export const graph = (wf: Workflow): Graph => {
  const o = order(wf)
  const nodes: Graph['nodes'] = []
  const edges: Graph['edges'] = []
  for (const s of wf.stages) {
    nodes.push({ id: s.name, title: s.title, kind: s.kind, ...(s.role && { role: s.role }), checkpoint: s.kind === 'human' })
    const checkpoint = (suffix: string, label: string) => nodes.push({ id: `${s.name}:${suffix}`, title: label, kind: 'human', checkpoint: true })
    if (s.kind === 'triage') checkpoint('refine', GRAPH_CHECKPOINT.refine)
    if (s.gate === 'human') checkpoint('gate', s.kind === 'plan' ? GRAPH_CHECKPOINT.plan : GRAPH_CHECKPOINT.staging)
    if (s.production_gate === 'human') checkpoint('production', GRAPH_CHECKPOINT.production)
    for (const [outcome, to] of Object.entries(s.outcomes)) edges.push({ from: s.name, to, outcome, back: o.includes(to) && o.indexOf(to) < o.indexOf(s.name) })
  }
  return { nodes, edges }
}
