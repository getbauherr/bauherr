import { isMap, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import { lint, NEEDS_ROLE, RESERVED, WIP, type Kind } from './workflow-rules'
import type { CheckpointKey } from './workflow-labels'
import type { When } from './workflow-when'

// Browser-safe. The workflow editor's document operations: each takes the factory file as text and returns the edited text (comments and layout kept); the result is not linted, callers run `lint`.

export type Doc = Record<string, any>
export type Draft = { ok: true; doc: Doc; findings: string[] } | { ok: false; error: string; line?: number }

/** The draft as data with the rule findings, or why the text is not YAML. */
export const readDraft = (yaml: string): Draft => {
  const d = parseDocument(yaml)
  if (d.errors.length) return { ok: false, error: d.errors[0]!.message.split('\n')[0]!, line: d.errors[0]!.linePos?.[0]?.line }
  const doc = d.toJS() as Doc
  return { ok: true, doc, findings: lint(doc) }
}

const FORWARD: Partial<Record<Kind, string>> = { triage: 'plan', plan: 'done', build: 'done', review: 'clean', release: 'accepted', container: 'children_done' }
export const stagesOf = (doc: Doc): Doc[] => (Array.isArray(doc?.workflow?.stages) ? doc.workflow.stages : [])
export const kindStage = (doc: Doc, kind: Kind): Doc | undefined => stagesOf(doc).find((s) => s.kind === kind)
/** The path a ticket normally takes out of the stage: the one a new step is spliced into. */
export const forwardKey = (s: Doc): string | undefined => FORWARD[s.kind as Kind] ?? Object.keys(s.outcomes ?? {})[0]
export const forwardTarget = (s: Doc): string | undefined => (forwardKey(s) ? s.outcomes?.[forwardKey(s)!] : undefined)
export const isCustom = (s: Doc): boolean => s.kind === 'agent' || s.kind === 'human'
export const takesRole = (kind: Kind): boolean => NEEDS_ROLE.includes(kind)
export const hasLimit = (kind: Kind): boolean => WIP.includes(kind)

/** Name of a new stage or outcome: the slug of its title, not in `taken`. */
export const slugOf = (title: string, taken: Iterable<string>, fallback = 'step'): string => {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(?=[^a-z])/, fallback + '-').replace(/-+$/, '') || fallback
  const used = new Set(taken)
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`
    if (!used.has(name) && !RESERVED.includes(name)) return name
  }
}

const take = (doc: Doc): string[] => [...stagesOf(doc).map((s) => String(s.name)), ...Object.keys(doc?.workflow?.migrate ?? {}), ...Object.keys(doc?.workflow?.aliases ?? {})]

const open = (yaml: string): Document => {
  const d = parseDocument(yaml)
  if (d.errors.length) throw new Error(d.errors[0]!.message)
  return d
}
const text = (d: Document): string => d.toString({ lineWidth: 0 })
const at = (d: Document, name: string): number => {
  const i = stagesOf(d.toJS()).findIndex((s) => s.name === name)
  if (i < 0) throw new Error(`no step "${name}"`)
  return i
}
const seq = (d: Document): YAMLSeq => d.getIn(['workflow', 'stages']) as YAMLSeq
const stageNode = (d: Document, obj: Doc) => {
  const n = d.createNode(obj) as YAMLMap
  n.flow = true
  const o = n.get('outcomes', true)
  if (isMap(o)) o.flow = true
  return n
}
/** Points every path that leads to `from` (all of them, or only forward ones) at `to`. */
const retarget = (d: Document, from: string, to: string, only: (s: Doc, key: string) => boolean = () => true) => {
  stagesOf(d.toJS()).forEach((s, i) => {
    for (const [key, t] of Object.entries(s.outcomes ?? {})) if (t === from && only(s, key)) d.setIn(['workflow', 'stages', i, 'outcomes', key], to)
  })
}

const edit = (yaml: string, fn: (d: Document) => void): string => {
  const d = open(yaml)
  fn(d)
  return text(d)
}

/** Sets one field of a stage; `undefined` removes it. */
export const setStageField = (yaml: string, stage: string, key: string, value: unknown): string =>
  edit(yaml, (d) => {
    const path = ['workflow', 'stages', at(d, stage), key]
    if (value === undefined) d.deleteIn(path)
    else d.setIn(path, value)
  })

/** Sets the condition of a step (it runs only when the change matches); `undefined` or an empty one makes it run for every ticket. */
export const setWhen = (yaml: string, stage: string, when: When | undefined): string =>
  edit(yaml, (d) => {
    const path = ['workflow', 'stages', at(d, stage), 'when']
    if (!when || !Object.keys(when).length) return void d.deleteIn(path)
    const n = d.createNode(when) as YAMLMap
    n.flow = true
    d.setIn(path, n)
  })

export const setTitle = (yaml: string, stage: string, title: string): string => setStageField(yaml, stage, 'title', title.trim() || undefined)

const GATE: Record<Exclude<CheckpointKey, 'refine'>, [Kind, 'gate' | 'production_gate']> = { plan: ['plan', 'gate'], staging: ['release', 'gate'], production: ['release', 'production_gate'] }
/** Switches a checkpoint of the plan or release stage (found by kind). */
export const setCheckpoint = (yaml: string, which: Exclude<CheckpointKey, 'refine'>, on: boolean): string => {
  const [kind, key] = GATE[which]
  const s = kindStage(open(yaml).toJS(), kind)
  if (!s) throw new Error(`no ${kind} step`)
  return setStageField(yaml, s.name, key, on ? 'human' : undefined)
}
export const checkpointOn = (s: Doc | undefined, which: Exclude<CheckpointKey, 'refine'>): boolean => s?.[GATE[which][1]] === 'human'

export const setPath = (yaml: string, stage: string, outcome: string, target: string): string =>
  edit(yaml, (d) => void d.setIn(['workflow', 'stages', at(d, stage), 'outcomes', outcome], target))

export const removePath = (yaml: string, stage: string, outcome: string): string => edit(yaml, (d) => void d.deleteIn(['workflow', 'stages', at(d, stage), 'outcomes', outcome]))

/** Renames a path of an agent or decision step, keeping its place in the list. */
export const renamePath = (yaml: string, stage: string, from: string, to: string): string =>
  edit(yaml, (d) => {
    const i = at(d, stage)
    const next = Object.fromEntries(Object.entries((d.toJS().workflow.stages[i].outcomes ?? {}) as Doc).map(([k, v]) => [k === from ? to : k, v]))
    d.setIn(['workflow', 'stages', i, 'outcomes'], stageNode(d, { outcomes: next }).get('outcomes', true))
  })

export type NewStep = { after: string; kind: 'agent' | 'human'; title: string; role?: string; skill?: string; choices?: string[]; when?: When }

/** Splices a step in after `after`: that step's forward path leads to it and it leads on to the old target. Returns the new text and the step's name. */
export const addStep = (yaml: string, s: NewStep): { yaml: string; name: string } => {
  const d = open(yaml)
  const doc = d.toJS() as Doc
  const stages = stagesOf(doc)
  const prev = stages[at(d, s.after)]!
  const key = forwardKey(prev)
  const next = forwardTarget(prev)
  if (!key || !next) throw new Error('This step has no path to continue from.')
  const name = slugOf(s.title, take(doc))
  const build = kindStage(doc, 'build')
  const back = build && stages.indexOf(prev) >= stages.indexOf(build) ? build.name : prev.name
  const choices = [...(s.choices ?? [])].map((c) => c.trim()).filter(Boolean)
  const keys: string[] = []
  for (const c of choices) keys.push(slugOf(c, keys, 'choice'))
  const outcomes: Doc = s.kind === 'agent' ? { pass: next, findings: back } : Object.fromEntries(keys.map((k, i) => [k, i === 0 ? next : back]))
  const step: Doc = { name, title: s.title.trim(), kind: s.kind, ...(s.kind === 'agent' && { role: s.role, skill: s.skill }), ...(s.when && Object.keys(s.when).length && { when: s.when }), outcomes }
  let i = at(d, s.after) + 1
  while (stages[i]?.kind === 'container') i++
  seq(d).items.splice(i, 0, stageNode(d, step))
  d.setIn(['workflow', 'stages', at(d, s.after), 'outcomes', key], name)
  return { yaml: text(d), name }
}

/** Removes a step; paths that led to it lead to its forward target. */
export const removeStep = (yaml: string, name: string): string =>
  edit(yaml, (d) => {
    const i = at(d, name)
    const s = stagesOf(d.toJS())[i]!
    const to = forwardTarget(s)
    if (to) retarget(d, name, to)
    seq(d).items.splice(i, 1)
  })

/** Swaps a step with the next one in the flow (the stage after it in the file, containers skipped); the paths between them follow. */
export const swapWithNext = (yaml: string, name: string): string =>
  edit(yaml, (d) => {
    const doc = d.toJS() as Doc
    const stages = stagesOf(doc)
    const i = at(d, name)
    const a = stages[i]!
    let j = i + 1
    while (stages[j]?.kind === 'container') j++
    const b = stages[j]
    if (!b || forwardTarget(a) !== b.name) throw new Error('These two steps cannot swap places.')
    const fwd = (s: Doc, key: string) => key === forwardKey(s)
    const c = forwardTarget(b)
    retarget(d, a.name, b.name, (s, k) => s.name !== b.name && fwd(s, k))
    d.setIn(['workflow', 'stages', i, 'outcomes', forwardKey(a)!], c)
    d.setIn(['workflow', 'stages', j, 'outcomes', forwardKey(b)!], a.name)
    const items = seq(d).items
    const [moved] = items.splice(j, 1)
    items.splice(i, 0, moved!)
  })

/** The next step of the flow in the file (containers skipped), or undefined. */
export const neighbour = (doc: Doc, name: string, dir: 1 | -1): Doc | undefined => {
  const stages = stagesOf(doc)
  let j = stages.findIndex((s) => s.name === name) + dir
  while (stages[j]?.kind === 'container') j += dir
  return stages[j]
}

/** Moves a custom step one place: down is a swap with the next step, up a swap of the previous step with it. */
export const moveStep = (yaml: string, name: string, dir: 1 | -1): string => {
  if (dir === 1) return swapWithNext(yaml, name)
  const before = neighbour(open(yaml).toJS(), name, -1)
  if (!before) throw new Error('This step is already first.')
  return swapWithNext(yaml, before.name)
}

/** Large tickets can be split: the plan's split path together with the container stage. */
export const setSplit = (yaml: string, on: boolean): string =>
  edit(yaml, (d) => {
    const doc = d.toJS() as Doc
    const plan = kindStage(doc, 'plan')
    if (!plan) throw new Error('The workflow has no plan step.')
    const container = kindStage(doc, 'container')
    const pi = at(d, plan.name)
    if (on) {
      if (container) return
      const done = kindStage(doc, 'done')!
      const name = slugOf('parent', take(doc))
      d.setIn(['workflow', 'stages', pi, 'outcomes', 'split'], name)
      seq(d).items.splice(pi + 1, 0, stageNode(d, { name, title: 'Split', kind: 'container', outcomes: { children_done: done.name } }))
    } else {
      d.deleteIn(['workflow', 'stages', pi, 'outcomes', 'split'])
      if (container) seq(d).items.splice(at(d, container.name), 1)
    }
  })

/** `workflow.migrate`: where the tickets of a removed step go; `undefined` clears it. */
export const setMigrate = (yaml: string, from: string, to: string | undefined): string =>
  edit(yaml, (d) => {
    const path = ['workflow', 'migrate']
    if (to !== undefined) d.setIn([...path, from], to)
    else {
      d.deleteIn([...path, from])
      const left = d.toJS().workflow.migrate
      if (left && !Object.keys(left).length) d.deleteIn(path)
    }
  })

/** Folds the Workspace's old WIP overrides into the stages' `wip`, so the limits in force are the ones the file shows. */
export const foldWip = (yaml: string, limits: Record<string, number> | null | undefined): string => {
  if (!limits) return yaml
  return edit(yaml, (d) => {
    stagesOf(d.toJS()).forEach((s, i) => {
      if (!hasLimit(s.kind)) return
      const path = ['workflow', 'stages', i, 'wip']
      if (limits[s.name] > 0) d.setIn(path, limits[s.name])
      else d.deleteIn(path)
    })
  })
}

export type Checkpoint = { key: CheckpointKey | 'human'; stage: string; on: boolean; always?: boolean }

/** Every place the factory can ask a person, in flow order; `on` ones are the points the person is asked at. */
export const checkpointsOf = (doc: Doc): Checkpoint[] => {
  const out: Checkpoint[] = []
  for (const s of stagesOf(doc)) {
    const add = (key: Checkpoint['key'], on: boolean, always?: boolean) => out.push({ key, stage: s.name, on, ...(always && { always }) })
    if (s.kind === 'triage') add('refine', true, true)
    else if (s.kind === 'plan') add('plan', checkpointOn(s, 'plan'))
    else if (s.kind === 'release') {
      add('staging', checkpointOn(s, 'staging'))
      add('production', checkpointOn(s, 'production'))
    } else if (s.kind === 'human') add('human', true)
  }
  return out
}
