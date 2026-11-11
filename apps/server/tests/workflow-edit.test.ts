import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeChanges } from '../src/lib/workflow-describe'
import * as e from '../src/lib/workflow-edit'
import { lint } from '../src/lib/workflow-rules'

const pack = (f: string) => readFileSync(fileURLToPath(new URL(`../../../pack/${f}`, import.meta.url)), 'utf8')
const base = pack('factory.yaml')
const careful = pack('presets/careful.yaml')
const doc = (y: string) => {
  const d = e.readDraft(y)
  if (!d.ok) throw new Error(d.error)
  return d.doc
}
const valid = (y: string) => expect(lint(doc(y))).toEqual([])
const stage = (y: string, n: string) => e.stagesOf(doc(y)).find((s) => s.name === n)!

describe('readDraft', () => {
  it('reads the shipped file without findings', () => expect(e.readDraft(base)).toMatchObject({ ok: true, findings: [] }))
  it('reports invalid YAML with its line', () => expect(e.readDraft('version: 1\nteam: [\n')).toMatchObject({ ok: false, line: expect.any(Number) }))
})

describe('field operations keep the file valid and keep comments', () => {
  it('title, role, skill, limit, checkpoint', () => {
    let y = e.setTitle(base, 'build', 'Construction')
    y = e.setStageField(y, 'build', 'wip', 4)
    y = e.setStageField(y, 'review', 'role', 'test')
    y = e.setCheckpoint(y, 'plan', false)
    y = e.setCheckpoint(y, 'staging', true)
    valid(y)
    expect(stage(y, 'build')).toMatchObject({ title: 'Construction', wip: 4 })
    expect(stage(y, 'review').role).toBe('test')
    expect(stage(y, 'plan').gate).toBeUndefined()
    expect(stage(y, 'release').gate).toBe('human')
    expect(y).toContain('# The factory: the team and the workflow')
    expect(e.setStageField(y, 'build', 'wip', undefined)).not.toContain('wip: 4')
  })
  it('setPath and renamePath', () => {
    valid(e.setPath(base, 'build', 'stuck', 'backlog'))
    valid(e.setPath(base, 'plan', 'decisions', 'triage'))
    const { yaml, name } = e.addStep(base, { after: 'build', kind: 'human', title: 'Sign-off', choices: ['Approve', 'Reject'] })
    const r = e.renamePath(yaml, name, 'reject', 'send-back')
    valid(r)
    expect(Object.keys(stage(r, name).outcomes)).toEqual(['approve', 'send-back'])
  })
})

describe('addStep', () => {
  it('splices an agent step after build, returning to build', () => {
    const { yaml, name } = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security review', role: 'security', skill: 'mr-security-review' })
    valid(yaml)
    expect(name).toBe('security-review')
    expect(stage(yaml, 'build').outcomes.done).toBe(name)
    expect(stage(yaml, name).outcomes).toEqual({ pass: 'review', findings: 'build' })
    const order = e.stagesOf(doc(yaml)).map((s) => s.name)
    expect(order.indexOf(name)).toBe(order.indexOf('build') + 1)
  })
  it('after plan the return path is the previous step, and the container stays next to plan', () => {
    const { yaml, name } = e.addStep(base, { after: 'plan', kind: 'agent', title: 'Design check', role: 'ux', skill: 'review' })
    valid(yaml)
    expect(stage(yaml, name).outcomes).toEqual({ pass: 'build', findings: 'plan' })
    const order = e.stagesOf(doc(yaml)).map((s) => s.name)
    expect(order.slice(0, 4)).toEqual(['triage', 'plan', 'parent', name])
  })
  it('a decision has 1 to 4 choices; the first leads on, the others return', () => {
    const { yaml, name } = e.addStep(base, { after: 'build', kind: 'human', title: 'Ship it?', choices: ['Yes', 'No', 'Later'] })
    valid(yaml)
    expect(stage(yaml, name).outcomes).toEqual({ yes: 'review', no: 'build', later: 'build' })
  })
  it('names are unique and never reuse a stage, a migrate or an alias key', () => {
    let y = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security', role: 'security', skill: 'review' }).yaml
    const second = e.addStep(y, { after: 'build', kind: 'agent', title: 'Security', role: 'security', skill: 'review' })
    expect(second.name).toBe('security-2')
    valid(second.yaml)
    y = e.setMigrate(base, 'old-step', 'build')
    expect(e.addStep(y, { after: 'build', kind: 'agent', title: 'Old step', role: 'test', skill: 'review' }).name).toBe('old-step-2')
    expect(e.slugOf('3d check', [])).toBe('step-3d-check')
    expect(e.slugOf('Backlog', [])).toBe('backlog-2')
  })
  it('positions the rules forbid fail lint', () => {
    for (const after of ['review', 'release']) {
      const { yaml } = e.addStep(base, { after, kind: 'agent', title: 'Extra', role: 'test', skill: 'review' })
      expect(lint(doc(yaml)).length).toBeGreaterThan(0)
    }
    for (const after of ['triage', 'plan', 'build']) valid(e.addStep(base, { after, kind: 'agent', title: 'Extra', role: 'test', skill: 'review' }).yaml)
  })
})

describe('removeStep and moveStep', () => {
  const withTwo = () => {
    const a = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security', role: 'security', skill: 'mr-security-review' })
    return e.addStep(a.yaml, { after: a.name, kind: 'human', title: 'Look', choices: ['Fine', 'Redo'] })
  }
  it('removing re-links to the forward target', () => {
    const { yaml, name } = withTwo()
    const r = e.removeStep(yaml, 'security')
    valid(r)
    expect(stage(r, 'build').outcomes.done).toBe(name)
    expect(e.removeStep(careful, 'security-review')).toSatisfy((y: string) => lint(doc(y)).length === 0 && stage(y, 'build').outcomes.done === 'ux-review')
  })
  it('move down and up swap two custom steps', () => {
    const { yaml, name } = withTwo()
    const down = e.moveStep(yaml, 'security', 1)
    valid(down)
    const order = e.stagesOf(doc(down)).map((s) => s.name)
    expect(order.indexOf(name)).toBeLessThan(order.indexOf('security'))
    expect(stage(down, 'build').outcomes.done).toBe(name)
    const up = e.moveStep(down, 'security', -1)
    valid(up)
    expect(e.stagesOf(doc(up)).map((s) => s.name)).toEqual(e.stagesOf(doc(yaml)).map((s) => s.name))
    expect(() => e.moveStep(base, 'plan', 1)).not.toThrow()
  })
  it('a swap the rules forbid fails lint', () => {
    expect(lint(doc(e.moveStep(careful, 'test-review', 1))).length).toBeGreaterThan(0)
  })
})

describe('split, migrate, fold', () => {
  it('toggles the split path with its container', () => {
    const off = e.setSplit(base, false)
    valid(off)
    expect(e.stagesOf(doc(off)).some((s) => s.kind === 'container')).toBe(false)
    expect(stage(off, 'plan').outcomes.split).toBeUndefined()
    const on = e.setSplit(off, true)
    valid(on)
    expect(stage(on, 'plan').outcomes.split).toBe('parent')
    expect(e.setSplit(on, true)).toBe(on)
  })
  it('migrate adds and clears', () => {
    const { yaml } = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security', role: 'security', skill: 'review' })
    const removed = e.setMigrate(e.removeStep(yaml, 'security'), 'security', 'build')
    valid(removed)
    expect(doc(removed).workflow.migrate).toEqual({ security: 'build' })
    expect(doc(e.setMigrate(removed, 'security', undefined)).workflow.migrate).toBeUndefined()
  })
  it('folds the old WIP overrides into the stages', () => {
    const y = e.foldWip(base, { plan: 1, build: 5 })
    valid(y)
    expect(stage(y, 'plan').wip).toBe(1)
    expect(stage(y, 'build').wip).toBe(5)
    expect(stage(y, 'review').wip).toBeUndefined()
    expect(e.foldWip(base, null)).toBe(base)
  })
})

describe('checkpointsOf', () => {
  it('lists the points in flow order with their state', () => {
    expect(e.checkpointsOf(doc(base)).map((c) => `${c.key}:${c.on}`)).toEqual(['refine:true', 'plan:true', 'staging:false', 'production:true'])
    const { yaml } = e.addStep(base, { after: 'build', kind: 'human', title: 'Sign-off', choices: ['Ok'] })
    expect(e.checkpointsOf(doc(yaml)).map((c) => c.key)).toEqual(['refine', 'plan', 'human', 'staging', 'production'])
  })
})

describe('describeChanges', () => {
  const after = (y: string) => describeChanges(doc(base), doc(y))
  it('is empty for no change', () => expect(after(base)).toEqual([]))
  it('says it in plain words', () => {
    let y = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security review', role: 'security', skill: 'mr-security-review' }).yaml
    y = e.setCheckpoint(y, 'plan', false)
    y = e.setStageField(y, 'build', 'wip', 4)
    y = e.setStageField(y, 'review', 'role', 'test')
    y = e.setTitle(y, 'release', 'Release')
    expect(after(y)).toEqual([
      'New step Security review after Build, worked by Security specialist',
      'Plan: you are no longer asked to approve the plan',
      'Build: at most 2 → 4 tickets at a time',
      'Review: now worked by Test specialist',
      'Step renamed: Staging → Release',
    ])
  })
  it('names removed steps, split and moved steps', () => {
    const a = e.addStep(careful, { after: 'build', kind: 'human', title: 'Look', choices: ['Fine'] })
    expect(describeChanges(doc(careful), doc(e.removeStep(careful, 'security-review')))).toContain('Removed step Security review')
    expect(describeChanges(doc(base), doc(e.setSplit(base, false)))).toEqual(['Plan: large tickets can no longer be split into sub-tickets'])
    expect(describeChanges(doc(a.yaml), doc(e.moveStep(a.yaml, a.name, 1)))).toContain('Step moved: Look now comes after Security review')
  })
  it('names role and migrate changes', () => {
    const y = e.setMigrate(base, 'gone', 'build')
    expect(after(y)).toEqual(['Tickets in Gone move to Build'])
  })
})
