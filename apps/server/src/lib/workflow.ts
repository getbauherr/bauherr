import { readFileSync } from 'node:fs'
import { GRAPH_CHECKPOINT } from './checkpoints'
import { resolve } from 'node:path'
import { IN_FLIGHT, LIVE, WIP, askedBy, jobOf, lint, parseFactory, type Addressee, type JobDef, type Kind, type Role, type StageDef, type Workflow } from './workflow-rules'

export * from './workflow-rules'

export type Graph = { nodes: { id: string; title: string; kind: Kind; role?: string; checkpoint: boolean; jobs?: { id: string; kind: 'agent' | 'human'; role?: string; blocking: boolean; needs: string[] }[] }[]; edges: { from: string; to: string; outcome: string; back: boolean }[] }

const job = ({ id, kind, role, skill, needs, when, blocking, outcomes }: Record<string, any>, stageOutcomes: string[], review = false): JobDef => {
  const o: Record<string, string> = outcomes ?? (review ? { done: 'done' } : Object.fromEntries(stageOutcomes.map((k, i) => [k, i ? k : 'done'])))
  return { id, kind: kind ?? 'agent', role, skill, needs: needs ?? [], ...(when && { when }), blocking: blocking ?? true, outcomes: o, outcomeOrder: Object.keys(o) }
}

const ownReviewJob = (j: Record<string, any>, s: Record<string, any>, earlier: string[]): JobDef => {
  const outcomes = Object.fromEntries(Object.keys(s.outcomes).map((k) => [k, k]))
  return { id: j.id, kind: 'agent', role: s.role, skill: s.skill, needs: j.needs ?? earlier, blocking: true, outcomes, outcomeOrder: Object.keys(outcomes) }
}

export const compile = (doc: unknown): Workflow => {
  const findings = lint(doc)
  if (findings.length) throw new Error(`invalid factory file:\n- ${findings.join('\n- ')}`)
  const d = doc as Record<string, any>
  return {
    version: 1,
    roles: Object.entries(d.team.roles as Record<string, Omit<Role, 'id'>>).map(([id, r]) => ({ id, ...r })),
    stages: (d.workflow.stages as Record<string, any>[]).map(({ refine, gate: gateKey, production_gate, jobs: jobKeys, ...s }) => {
      const human = s.kind === 'plan' ? (jobKeys as Record<string, any>[] | undefined)?.find((j) => j.kind === 'human') : undefined
      const gate = human ? { by: human.by ?? 'bauherr' } : gateKey
      const agents = s.kind === 'plan' ? (jobKeys as Record<string, any>[] | undefined)?.slice(1).filter((j) => j.kind !== 'human').map((j) => ({ needs: [s.name], ...j })) : undefined
      const jobs = s.kind === 'plan' ? agents?.length && [{ id: s.name, role: s.role, skill: s.skill, outcomes: Object.fromEntries(Object.keys(s.outcomes ?? {}).map((k) => [k, k])) }, ...agents] : jobKeys
      return ({ ...s, ...(gate !== undefined && { gate: 'human', ...(askedBy(gate) === 'product-owner' && { gate_by: 'product-owner' }) }), ...(production_gate !== undefined && { production_gate: 'human', ...(askedBy(production_gate) === 'product-owner' && { production_gate_by: 'product-owner' }) }), ...(refine?.by === 'product-owner' && { refine_by: 'product-owner' }), ...(jobs && { jobs: (jobs as Record<string, any>[]).map((j, i, all) => (s.kind === 'review' && i === all.length - 1 ? ownReviewJob(j, s, all.slice(0, i).map((x) => x.id)) : job(j, Object.keys(s.outcomes ?? {}), s.kind === 'review'))) }), title: s.title ?? (s.name ?? '').charAt(0).toUpperCase() + (s.name ?? '').slice(1), outcomes: s.outcomes ?? {}, ...((s.kind === 'human' || s.kind === 'agent') && { outcomeOrder: Object.keys(s.outcomes ?? {}) }) }) as StageDef
    }),
    aliases: d.workflow.aliases ?? {},
  }
}

export const packDir = () => process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')
let cached: { path: string; wf: Workflow } | undefined

export const corePack = () => resolve(process.cwd(), '../../pack')

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
export const nameOf = (wf: Workflow, kind: Kind): string => {
  const s = byKind(wf, kind)
  if (!s) throw new Error(`the workflow has no ${kind} stage`)
  return s.name
}
export const kindOf = (wf: Workflow, name: string): Kind | undefined => stage(wf, name)?.kind
export const is = (wf: Workflow, name: string, ...kinds: Kind[]): boolean => kinds.includes(kindOf(wf, name) as Kind)
export const title = (wf: Workflow, name: string): string => stage(wf, name)?.title ?? name
export const roleOf = (wf: Workflow, name: string): Role | undefined => wf.roles.find((r) => r.id === stage(wf, name)?.role)
export const roleOfRun = (wf: Workflow, run: Record<string, any>): Role | undefined => {
  const def = stage(wf, run.stage)
  return wf.roles.find((r) => r.id === (def && jobOf(def, run))?.role)
}
export const stagesOfRole = (wf: Workflow, roleId: string): string[] => wf.stages.filter((s) => s.role === roleId || s.jobs?.some((j) => j.role === roleId)).map((s) => s.name)
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
export const modeStages = (wf: Workflow): string[] => named(wf, 'plan', 'build')
export const liveStages = (wf: Workflow): string[] => named(wf, ...LIVE)
export const inFlight = (wf: Workflow): string[] => named(wf, ...IN_FLIGHT)
export const repairable = (wf: Workflow): string[] => wf.stages.filter((s) => s.kind !== 'container' && s.kind !== 'done').map((s) => s.name)
export const gates = (wf: Workflow): { plan: boolean; staging: boolean; production: boolean } => ({
  plan: byKind(wf, 'plan')?.gate === 'human',
  staging: byKind(wf, 'release')?.gate === 'human',
  production: byKind(wf, 'release')?.production_gate === 'human',
})
export type CheckpointOf = 'refine' | 'plan' | 'staging' | 'production' | 'human'
export const checkpointBy = (wf: Workflow, key: CheckpointOf, name?: string): Addressee =>
  (key === 'refine' ? byKind(wf, 'triage')?.refine_by : key === 'plan' ? byKind(wf, 'plan')?.gate_by : key === 'staging' ? byKind(wf, 'release')?.gate_by : key === 'production' ? byKind(wf, 'release')?.production_gate_by : name ? stage(wf, name)?.by : undefined) ?? 'bauherr'
export const excludeLabels = (wf: Workflow): string[] => byKind(wf, 'triage')?.exclude_labels ?? []

export const graph = (wf: Workflow): Graph => {
  const o = order(wf)
  const nodes: Graph['nodes'] = []
  const edges: Graph['edges'] = []
  for (const s of wf.stages) {
    nodes.push({ id: s.name, title: s.title, kind: s.kind, ...(s.role && { role: s.role }), checkpoint: s.kind === 'human', ...(s.jobs && { jobs: s.jobs.map(({ id, kind, role, blocking, needs }) => ({ id, kind, ...(role && { role }), blocking, needs })) }) })
    const checkpoint = (suffix: string, label: string) => nodes.push({ id: `${s.name}:${suffix}`, title: label, kind: 'human', checkpoint: true })
    if (s.kind === 'triage') checkpoint('refine', GRAPH_CHECKPOINT.refine)
    if (s.gate === 'human') checkpoint('gate', s.kind === 'plan' ? GRAPH_CHECKPOINT.plan : GRAPH_CHECKPOINT.staging)
    if (s.production_gate === 'human') checkpoint('production', GRAPH_CHECKPOINT.production)
    for (const [outcome, to] of Object.entries(s.outcomes)) edges.push({ from: s.name, to, outcome, back: o.includes(to) && o.indexOf(to) < o.indexOf(s.name) })
  }
  return { nodes, edges }
}
