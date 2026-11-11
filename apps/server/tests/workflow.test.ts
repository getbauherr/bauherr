import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as w from '../src/lib/workflow'

const pack = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const defaultDoc = () => w.parseFactory(readFileSync(fileURLToPath(new URL('../../../pack/factory.yaml', import.meta.url)), 'utf8')) as any
const wf = w.compile(defaultDoc())

afterEach(() => {
  delete process.env.BAUHERR_PACK_DIR
})

describe('derived lists reproduce the constants they replace', () => {
  it('order, board, pullRank', () => {
    expect(w.order(wf)).toEqual(['triage', 'plan', 'parent', 'build', 'review', 'release', 'done'])
    expect(w.board(wf)).toEqual(['triage', 'plan', 'build', 'review', 'release', 'done'])
    expect(w.pullRank(wf)).toEqual(['release', 'review', 'build', 'plan', 'triage'])
  })
  it('isForward', () => {
    expect(w.isForward(wf, 'plan', 'build')).toBe(true)
    expect(w.isForward(wf, 'build', 'plan')).toBe(false)
    expect(w.isForward(wf, 'plan', 'plan')).toBe(false)
    expect(w.isForward(wf, 'plan', 'nope')).toBe(false)
    expect(w.isForward(wf, 'nope', 'done')).toBe(false)
  })
  it('wip', () => {
    expect(w.wipStages(wf)).toEqual(['plan', 'build', 'review', 'release'])
    expect(w.defaultWip(wf)).toEqual({ plan: 3, build: 2, review: 3, release: 5 })
    expect(w.heldStages(wf)).toEqual(['review', 'build', 'plan'])
  })
  it('live, in flight, repairable, exclude labels', () => {
    expect(w.liveStages(wf)).toEqual(['plan', 'build', 'review'])
    expect(w.inFlight(wf)).toEqual(['plan', 'build', 'review', 'release'])
    expect(w.repairable(wf)).toEqual(['triage', 'plan', 'build', 'review', 'release'])
    expect(w.excludeLabels(wf)).toEqual(['wayfinder:map', 'wayfinder:grilling', 'wayfinder:research', 'bauherr:security-scan'])
  })
  it('lookups', () => {
    expect(w.title(wf, 'release')).toBe('Staging')
    expect(w.title(wf, 'plan')).toBe('Plan')
    expect(w.title(wf, 'nope')).toBe('nope')
    expect(w.kindOf(wf, 'parent')).toBe('container')
    expect(w.kindOf(wf, 'nope')).toBeUndefined()
    expect(w.is(wf, 'build', 'plan', 'build')).toBe(true)
    expect(w.byKind(wf, 'review')?.name).toBe('review')
    expect(w.roleOf(wf, 'build')?.id).toBe('engineer')
    expect(w.roleOf(wf, 'release')).toBeUndefined()
    expect(w.stagesOfRole(wf, 'engineer')).toEqual(['plan', 'build'])
    expect(w.target(wf, 'review', 'changes')).toBe('build')
    expect(w.target(wf, 'review', 'nope')).toBeUndefined()
  })
})

describe('gates match tests/human-gates.test.ts', () => {
  it.each([
    [undefined, { plan: true, staging: false, production: true }],
    ['gated-pack', { plan: true, staging: true, production: false }],
    ['bare-pack', { plan: false, staging: false, production: false }],
  ] as const)('%s', async (name, expected) => {
    if (name) process.env.BAUHERR_PACK_DIR = pack(name)
    expect(w.gates(w.DEFAULT())).toEqual(expected)
    const mode = await import('../src/lib/mode')
    expect(mode.humanGates(w.DEFAULT())).toEqual(['refine', ...(expected.plan ? ['plan'] : []), ...(expected.staging ? ['staging'] : []), ...(expected.production ? ['production'] : [])])
  })
  it('DEFAULT uses the core pack factory.yaml for a pack dir without one', () => {
    process.env.BAUHERR_PACK_DIR = pack('does-not-exist')
    expect(w.DEFAULT()).toEqual(wf)
  })
})

describe('lint', () => {
  const custom = () => {
    const d = defaultDoc()
    d.team.roles.security = { title: 'Security', provider: 'anthropic', model: 'x' }
    const s = d.workflow.stages
    s.find((x: any) => x.name === 'build').outcomes.done = 'security'
    s.splice(s.findIndex((x: any) => x.name === 'review'), 0,
      { name: 'security', kind: 'agent', role: 'security', skill: 'security-scan', outcomes: { pass: 'signoff', findings: 'build', unclear: 'escalate' } },
      { name: 'signoff', kind: 'human', outcomes: { approve: 'review', reject: 'build' } })
    return d
  }
  it('accepts the default file and a custom flow', () => {
    expect(w.lint(defaultDoc())).toEqual([])
    expect(w.lint(custom())).toEqual([])
    const c = w.compile(custom())
    expect(w.board(c)).toEqual(['triage', 'plan', 'build', 'security', 'signoff', 'review', 'release', 'done'])
    expect(w.graph(c).nodes.find((n) => n.id === 'signoff')?.checkpoint).toBe(true)
  })
  it('the default team has the specialists, unused by any stage, and one exceptions role', () => {
    const c = w.compile(defaultDoc())
    expect(c.roles.map((r) => r.id)).toEqual(['orchestrator', 'engineer', 'reviewer', 'security', 'ux', 'test'])
    expect(c.roles.filter((r) => r.exceptions).map((r) => r.id)).toEqual(['orchestrator'])
    expect(w.stagesOfRole(c, 'security')).toEqual([])
    expect(c.roles.every((r) => r.profile_file && r.profile_file.startsWith('roles/'))).toBe(true)
  })
  it('compile keeps avatar and an explicit provider and model', () => {
    const d = defaultDoc()
    Object.assign(d.team.roles.ux, { skills: ['Flows'], avatar: 'fox', tier: undefined, provider: 'p', model: 'm', agents: 2 })
    expect(w.compile(d).roles.find((r) => r.id === 'ux')).toMatchObject({ skills: ['Flows'], avatar: 'fox', provider: 'p', model: 'm', agents: 2 })
  })
  it('compile throws listing the findings', () => {
    expect(() => w.compile({ ...defaultDoc(), version: 2 })).toThrow(/version must be 1/)
  })
  const stageOf = (d: any, name: string) => d.workflow.stages.find((x: any) => x.name === name)
  const cases: [string, (d: any) => void, string][] = [
    ['1 version', (d) => (d.version = 2), 'version must be 1'],
    ['1 name pattern', (d) => (stageOf(d, 'plan').name = 'Plan_X'), 'name must match'],
    ['1 reserved name', (d) => (stageOf(d, 'plan').name = 'scan'), 'name is reserved'],
    ['1 duplicate', (d) => d.workflow.stages.splice(1, 0, { ...stageOf(d, 'plan') }), 'duplicate name'],
    ['2 triage first', (d) => d.workflow.stages.reverse(), 'exactly one triage stage'],
    ['2 done last', (d) => d.workflow.stages.pop(), 'exactly one done stage'],
    ['2 at most one', (d) => d.workflow.stages.splice(4, 0, { ...stageOf(d, 'build'), name: 'build2' }), 'at most one build stage'],
    ['2 container iff split', (d) => delete stageOf(d, 'plan').outcomes.split, 'container stage exists if and only if'],
    ['3 all or none', (d) => d.workflow.stages.splice(d.workflow.stages.findIndex((x: any) => x.name === 'review'), 1), 'all present or all absent'],
    ['3 review.changes', (d) => (stageOf(d, 'review').outcomes.changes = 'plan'), 'outcome changes must target "build"'],
    ['4 outcome keys', (d) => delete stageOf(d, 'build').outcomes.stuck, 'missing stuck'],
    ['4 agent needs outcomes', (d) => d.workflow.stages.splice(3, 0, { name: 'x', kind: 'agent', role: 'engineer', outcomes: {} }), 'declare at least one outcome'],
    ['5 unknown target', (d) => (stageOf(d, 'build').outcomes.stuck = 'nowhere'), 'targets unknown stage "nowhere"'],
    ['5 unreachable', (d) => (stageOf(d, 'triage').outcomes.plan = 'backlog'), 'not reachable from the triage stage'],
    ['5 dead end', (d) => d.workflow.stages.splice(3, 0, { name: 'trap', kind: 'agent', role: 'engineer', outcomes: { x: 'escalate' } }) && (stageOf(d, 'build').outcomes.done = 'trap'), 'cannot reach the done stage'],
    ['6 unknown role', (d) => (stageOf(d, 'build').role = 'ghost'), 'role "ghost" is not in team.roles'],
    ['6 role required', (d) => delete stageOf(d, 'build').role, 'role is required'],
    ['6 role forbidden', (d) => (stageOf(d, 'release').role = 'engineer'), 'role is not allowed'],
    ['6 tier xor provider', (d) => Object.assign(d.team.roles.engineer, { provider: 'a', model: 'b' }), 'exactly one of tier or (provider and model)'],
    ['6 agents', (d) => (d.team.roles.engineer.agents = 0), 'agents must be a positive integer'],
    ['6 provider without model', (d) => Object.assign(d.team.roles.engineer, { tier: undefined, provider: 'a' }), 'exactly one of tier or (provider and model)'],
    ['6 model without provider', (d) => Object.assign(d.team.roles.engineer, { tier: undefined, model: 'b' }), 'exactly one of tier or (provider and model)'],
    ['6 a second exceptions role', (d) => (d.team.roles.engineer.exceptions = true), 'at most one role may have exceptions: true (found orchestrator, engineer)'],
    ['6 exceptions is a boolean', (d) => (d.team.roles.engineer.exceptions = 'yes'), 'exceptions must be true or false'],
    ['6 skills empty', (d) => (d.team.roles.engineer.skills = []), 'skills must be a list of 1 to 6 strings'],
    ['6 skills too many', (d) => (d.team.roles.engineer.skills = ['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'skills must be a list of 1 to 6 strings'],
    ['6 skills too long', (d) => (d.team.roles.engineer.skills = ['x'.repeat(25)]), 'skills must be a list of 1 to 6 strings'],
    ['6 skills not strings', (d) => (d.team.roles.engineer.skills = [1]), 'skills must be a list of 1 to 6 strings'],
    ['6 avatar', (d) => (d.team.roles.engineer.avatar = 5), 'avatar must be a non-empty string'],
    ['7 gate', (d) => (stageOf(d, 'build').gate = 'human'), 'gate: human is only allowed'],
    ['7 production_gate', (d) => (stageOf(d, 'plan').production_gate = 'human'), 'production_gate: human is only allowed'],
    ['7 wip', (d) => (stageOf(d, 'build').wip = 0), 'wip must be a positive integer'],
    ['7 wip kind', (d) => (stageOf(d, 'triage').wip = 2), 'wip must be a positive integer'],
    ['8 agent needs a skill', (d) => d.workflow.stages.splice(3, 0, { name: 'x', kind: 'agent', role: 'engineer', outcomes: { ok: 'build' } }), 'stage "x" (agent): skill is required'],
    ['8 human outcome count', (d) => d.workflow.stages.splice(3, 0, { name: 'h', kind: 'human', outcomes: { a: 'build', b: 'build', c: 'build', d: 'build', e: 'build' } }), '(human): 1 to 4 outcome keys'],
    ['8 human outcome key', (d) => d.workflow.stages.splice(3, 0, { name: 'h', kind: 'human', outcomes: { 'Bad Key': 'build' } }), '(human): 1 to 4 outcome keys'],
    ['8 review must follow build', (d) => (stageOf(d, 'build').outcomes.done = 'release'), 'must lead to the review stage "review", passing only through agent and human stages'],
    ['8 only review targets release', (d) => d.workflow.stages.splice(4, 0, { name: 'fast', kind: 'human', outcomes: { ship: 'release', back: 'build' } }) && (stageOf(d, 'build').outcomes.done = 'fast'), 'only the review stage may target the release stage'],
    ['9 migrate unknown target', (d) => (d.workflow.migrate = { old: 'ghost' }), 'workflow.migrate: "old" maps to unknown stage "ghost"'],
    ['7 mode', (d) => (stageOf(d, 'build').mode = 'manual'), 'mode must be session or autonomous'],
  ]
  it.each(cases)('rejects %s', (_n, mutate, message) => {
    const d = defaultDoc()
    mutate(d)
    expect(w.lint(d).join('\n')).toContain(message)
  })
})

it('graph of the default file', () => {
  expect(w.graph(wf)).toEqual({
    nodes: [
      { id: 'triage', title: 'Triage', kind: 'triage', role: 'orchestrator', checkpoint: false },
      { id: 'triage:refine', title: 'Answer questions', kind: 'human', checkpoint: true },
      { id: 'plan', title: 'Plan', kind: 'plan', role: 'engineer', checkpoint: false },
      { id: 'plan:gate', title: 'Approve plan', kind: 'human', checkpoint: true },
      { id: 'parent', title: 'Split', kind: 'container', checkpoint: false },
      { id: 'build', title: 'Build', kind: 'build', role: 'engineer', checkpoint: false },
      { id: 'review', title: 'Review', kind: 'review', role: 'reviewer', checkpoint: false },
      { id: 'release', title: 'Staging', kind: 'release', checkpoint: false },
      { id: 'release:production', title: 'Approve production', kind: 'human', checkpoint: true },
      { id: 'done', title: 'Done', kind: 'done', checkpoint: false },
    ],
    edges: [
      { from: 'triage', to: 'plan', outcome: 'plan', back: false },
      { from: 'triage', to: 'triage', outcome: 'refine', back: false },
      { from: 'triage', to: 'backlog', outcome: 'skip', back: false },
      { from: 'plan', to: 'build', outcome: 'done', back: false },
      { from: 'plan', to: 'parent', outcome: 'split', back: false },
      { from: 'plan', to: 'triage', outcome: 'decisions', back: true },
      { from: 'parent', to: 'done', outcome: 'children_done', back: false },
      { from: 'build', to: 'review', outcome: 'done', back: false },
      { from: 'build', to: 'escalate', outcome: 'stuck', back: false },
      { from: 'build', to: 'plan', outcome: 'replan', back: true },
      { from: 'review', to: 'release', outcome: 'clean', back: false },
      { from: 'review', to: 'build', outcome: 'changes', back: true },
      { from: 'review', to: 'triage', outcome: 'stop', back: true },
      { from: 'release', to: 'done', outcome: 'accepted', back: false },
      { from: 'release', to: 'build', outcome: 'changes', back: true },
    ],
  })
})
