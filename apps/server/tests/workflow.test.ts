import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
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
    expect(w.defaultWip(wf)).toEqual({ plan: 4, build: 2, review: 3, release: 5 })
    expect(w.heldStages(wf)).toEqual(['review', 'build', 'plan'])
  })
  it('live, in flight, repairable, exclude labels', () => {
    expect(w.liveStages(wf)).toEqual(['plan', 'build', 'review'])
    expect(w.inFlight(wf)).toEqual(['plan', 'build', 'review', 'release'])
    expect(w.repairable(wf)).toEqual(['triage', 'plan', 'build', 'review', 'release'])
    expect(w.excludeLabels(wf)).toEqual(['wayfinder:map', 'wayfinder:grilling', 'wayfinder:research', 'bauherr:security-scan', 'bauherr:docs-check'])
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
    // the shipped file asks the Product owner for staging acceptance per Product: the gate exists but is not on for every Product (`stagingGateOn`)
    [undefined, { plan: true, staging: true, production: true }, ['refine', 'plan', 'production']],
    ['gated-pack', { plan: true, staging: true, production: false }, ['refine', 'plan', 'staging']],
    ['bare-pack', { plan: false, staging: false, production: false }, ['refine']],
  ] as const)('%s', async (name, expected, human) => {
    if (name) process.env.BAUHERR_PACK_DIR = pack(name)
    expect(w.gates(w.DEFAULT())).toEqual(expected)
    const mode = await import('../src/lib/mode')
    expect(mode.humanGates(w.DEFAULT())).toEqual(human)
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
    expect(c.roles.map((r) => r.id)).toEqual(['orchestrator', 'engineer', 'reviewer', 'security', 'ux', 'test', 'docs', 'ax'])
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
      { id: 'plan', title: 'Plan', kind: 'plan', role: 'engineer', checkpoint: false, jobs: [{ id: 'plan', kind: 'agent', role: 'engineer', blocking: true, needs: [] }, { id: 'ax-scan', kind: 'agent', role: 'ax', blocking: false, needs: ['plan'] }] },
      { id: 'plan:gate', title: 'Approve plan', kind: 'human', checkpoint: true },
      { id: 'parent', title: 'Split', kind: 'container', checkpoint: false },
      { id: 'build', title: 'Build', kind: 'build', role: 'engineer', checkpoint: false },
      { id: 'review', title: 'Review', kind: 'review', role: 'reviewer', checkpoint: false },
      { id: 'release', title: 'Staging', kind: 'release', checkpoint: false },
      { id: 'release:gate', title: 'Accept on staging', kind: 'human', checkpoint: true },
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

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as any)[k])])) : v)
const hashFile = (path: string) => createHash('sha256').update(JSON.stringify(canon(w.compile(w.parseFactory(readFileSync(path, 'utf8')))))).digest('hex')

it('files without jobs keep their hash; the shipped factory, standard and careful files changed only by the plan Jobs and the ax role', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
  const expected: Record<string, string> = {
    [`${root}pack/factory.yaml`]: '4b7de56156cdaa4dff99ac2e6f7e3bc269adf70efc62937ef791bb9b28176415',
    [`${root}pack/presets/solo.yaml`]: '454b110bd5170fce5f0133a90dee014f587aa2ff8b69df837b3ccce5be3bca10',
    [`${root}pack/presets/standard.yaml`]: '12c85740fd5ce1810a82e7735ef89e4c366be94a4c48e3888ba5deafe5ecf7a8',
    [`${root}pack/presets/careful.yaml`]: '1a3f9306f01c3724b904d3f3eff1d028ac2c1052996751c33f09e1d1c1305bec',
    [`${fixtures}/bare-pack/factory.yaml`]: '4dd0536b8bfd0ec5a131fa8517d8e04e1b7db170e311d736820c65a7e000fb30',
    [`${fixtures}/custom-pack/factory.yaml`]: '3e5b636c36941e08c0b3270a4516320c781e3b6ecf94a48f3208c2fd73d18de0',
    [`${fixtures}/gated-pack/factory.yaml`]: 'c7c1856377b135e59f3afc3bb505c955153ac0b32eb9909e81007a9530834afa',
    [`${fixtures}/owner-pack/factory.yaml`]: 'f0585cef728d8a031d9e9560ca3ece1a132b33826c1f3cee8fc9b6f5c3264918',
    [`${fixtures}/renamed-pack/factory.yaml`]: '77bd6b01a9c6a0c762eedfcb939bf2fa1b6484f1fcf5e006ba8edc65036c74c9',
    [`${fixtures}/routing-pack/factory.yaml`]: '04a2fc4931b99cad01f94a0651c0020570e5494e614a243dfbf2b71630cc622d',
  }
  expect(readdirSync(fixtures).filter((d) => d.endsWith('-pack') && d !== 'jobs-pack' && d !== 'plan-jobs-pack').length).toBe(Object.keys(expected).length - 4)
  for (const [file, hash] of Object.entries(expected)) expect(hashFile(file), file).toBe(hash)
})

describe('jobs in stages', () => {
  const withJobs = (jobs: unknown, extra: Record<string, unknown> = {}) => {
    const d = defaultDoc()
    d.team.roles.ux = { title: 'UX', provider: 'anthropic', model: 'x' }
    const st = d.workflow.stages
    st.find((x: any) => x.name === 'build').outcomes.done = 'audit'
    st.splice(st.findIndex((x: any) => x.name === 'review'), 0, { name: 'audit', kind: 'agent', jobs, outcomes: { pass: 'review', findings: 'build' }, ...extra })
    return d
  }
  const two = [
    { id: 'security', role: 'security', skill: 'security-scan', outcomes: { pass: 'done', findings: 'findings' } },
    { id: 'ux', role: 'ux', skill: 'ux-review', when: { touches: 'ui' }, blocking: false, needs: ['security'] },
  ]
  it('compile normalises jobs and leaves the stage keys alone', () => {
    const c = w.compile(withJobs(two))
    const s = w.stage(c, 'audit')!
    expect(s.jobs).toEqual([
      { id: 'security', kind: 'agent', role: 'security', skill: 'security-scan', needs: [], blocking: true, outcomes: { pass: 'done', findings: 'findings' }, outcomeOrder: ['pass', 'findings'] },
      { id: 'ux', kind: 'agent', role: 'ux', skill: 'ux-review', needs: ['security'], when: { touches: 'ui' }, blocking: false, outcomes: { pass: 'done', findings: 'findings' }, outcomeOrder: ['pass', 'findings'] },
    ])
    expect(s.role).toBeUndefined()
    expect(w.jobsOf(s)).toBe(s.jobs)
    expect(w.jobOf(s, { job: 'ux' })?.id).toBe('ux')
    expect(w.jobOf(s, {})?.id).toBe('security')
  })
  it('the own Job of a stage without jobs is the stage itself', () => {
    const b = w.stage(wf, 'build')!
    expect(w.jobsOf(b)).toEqual([expect.objectContaining({ id: 'build', role: 'engineer', needs: [], blocking: true, outcomes: { done: 'done', stuck: 'stuck', replan: 'replan' } })])
    expect(w.jobOf(b, { job: null })?.id).toBe('build')
  })
  const stageDoc = (d: any) => d.workflow.stages.find((x: any) => x.name === 'audit')
  const bad: [string, (d: any) => void, string][] = [
    ['jobs on a build stage', (d) => (d.workflow.stages.find((x: any) => x.name === 'build').jobs = two), 'jobs are only allowed on agent and plan stages'],
    ['empty jobs', (d) => (stageDoc(d).jobs = []), 'jobs must be a non-empty list'],
    ['stage role', (d) => (stageDoc(d).role = 'security'), 'no role or skill of its own'],
    ['id pattern', (d) => (stageDoc(d).jobs[0].id = 'Bad_Id'), 'id must match'],
    ['id is the stage name', (d) => (stageDoc(d).jobs[0].id = 'audit'), 'id must not be the stage name'],
    ['duplicate id', (d) => (stageDoc(d).jobs[1].id = 'security'), 'duplicate job id'],
    ['kind ci', (d) => (stageDoc(d).jobs[0].kind = 'ci'), 'not supported yet'],
    ['kind human', (d) => (stageDoc(d).jobs[0].kind = 'human'), 'not supported yet'],
    ['unknown role', (d) => (stageDoc(d).jobs[0].role = 'ghost'), 'role "ghost" is not in team.roles'],
    ['role required', (d) => delete stageDoc(d).jobs[0].role, 'role is required'],
    ['skill required', (d) => delete stageDoc(d).jobs[0].skill, 'skill is required'],
    ['by on agent job', (d) => (stageDoc(d).jobs[0].by = 'bauherr'), 'by is only allowed on a human job'],
    ['needs a later job', (d) => (stageDoc(d).jobs[0].needs = ['ux']), 'not an earlier job'],
    ['needs itself', (d) => (stageDoc(d).jobs[1].needs = ['ux']), 'not an earlier job'],
    ['needs not a list', (d) => (stageDoc(d).jobs[1].needs = 'security'), 'needs must be a list'],
    ['when', (d) => (stageDoc(d).jobs[1].when = { bogus: 1 }), 'job "ux": when has an unknown key "bogus"'],
    ['blocking', (d) => (stageDoc(d).jobs[1].blocking = 'yes'), 'blocking must be true or false'],
    ['outcome target', (d) => (stageDoc(d).jobs[0].outcomes.findings = 'nowhere'), 'neither done nor an outcome of the stage'],
    ['no done outcome', (d) => (stageDoc(d).jobs[0].outcomes = { findings: 'findings' }), 'at least one outcome must map to done'],
    ['jobs on review', (d) => (d.workflow.stages.find((x: any) => x.name === 'review').jobs = two), 'jobs are only allowed on agent and plan stages'],
  ]
  it('accepts a valid stage with jobs', () => {
    expect(w.lint(withJobs(two))).toEqual([])
  })
  it.each(bad)('rejects %s', (_n, mutate, message) => {
    const d = withJobs(JSON.parse(JSON.stringify(two)))
    mutate(d)
    expect(w.lint(d).join('\n')).toContain(message)
  })
})

describe('jobs in the plan stage', () => {
  const planDoc = (jobs: unknown[] = [{ id: 'plan' }, { id: 'ax-scan', role: 'security', skill: 'harden', blocking: false, outcomes: { pass: 'done', findings: 'done' } }, { id: 'approve', kind: 'human', by: 'bauherr' }]) => {
    const d = defaultDoc()
    const p = d.workflow.stages.find((x: any) => x.name === 'plan')
    delete p.gate
    p.jobs = jobs
    return { d, p }
  }
  it('plan, scan and approval compile to the own Job, the scan after it, and the same human gate as gate: human', () => {
    const { d } = planDoc()
    const c = w.compile(d)
    const p = w.stage(c, 'plan')!
    expect(p.gate).toBe('human')
    expect(p.gate_by).toBeUndefined()
    expect(p.jobs).toEqual([
      expect.objectContaining({ id: 'plan', role: 'engineer', needs: [], blocking: true }),
      { id: 'ax-scan', kind: 'agent', role: 'security', skill: 'harden', needs: ['plan'], blocking: false, outcomes: { pass: 'done', findings: 'done' }, outcomeOrder: ['pass', 'findings'] },
    ])
    expect(w.gates(c)).toEqual(w.gates(wf))
    expect(w.jobOf(p, {})?.role).toBe('engineer')
    expect(w.jobOf(p, { job: 'ax-scan' })?.role).toBe('security')
  })
  it('a human job by the product owner compiles to gate_by', () => {
    const { d } = planDoc([{ id: 'plan' }, { id: 'approve', kind: 'human', by: 'product-owner' }])
    const p = w.stage(w.compile(d), 'plan')!
    expect(p.gate_by).toBe('product-owner')
    expect(p.jobs).toBeUndefined()
  })
  const bad: [string, (p: any) => void, string][] = [
    ['gate next to a human job', (p) => (p.gate = 'human'), 'a human job replaces gate'],
    ['a first job that is not the stage', (p) => (p.jobs[0].id = 'x'), 'the first job of a plan stage must be the stage itself'],
    ['a role on the own job', (p) => (p.jobs[0].role = 'engineer'), "the stage's own job takes no role"],
    ['two human jobs', (p) => p.jobs.push({ id: 'approve2', kind: 'human' }), 'at most one human job'],
    ['a human job not last', (p) => p.jobs.push({ id: 'more', role: 'security', skill: 'harden' }), 'the human job must be the last job'],
    ['a role on a human job', (p) => (p.jobs[2].role = 'security'), 'a human job takes no role'],
    ['an unknown approver', (p) => (p.jobs[2].by = 'nobody'), 'by must be bauherr or product-owner'],
    ['a ci job', (p) => (p.jobs[1].kind = 'ci'), 'not supported yet'],
  ]
  it.each(bad)('rejects %s', (_n, mutate, message) => {
    const { d, p } = planDoc()
    mutate(p)
    expect(w.lint(d).join('\n')).toContain(message)
  })
})

it('graph lists the Jobs of a stage on its node', () => {
  const d = defaultDoc()
  const p = d.workflow.stages.find((x: any) => x.name === 'plan')
  delete p.gate
  p.jobs = [{ id: 'plan' }, { id: 'ax-scan', role: 'security', skill: 'harden', blocking: false }, { id: 'approve', kind: 'human' }]
  const node = w.graph(w.compile(d)).nodes.find((n) => n.id === 'plan')!
  expect(node.jobs).toEqual([{ id: 'plan', kind: 'agent', role: 'engineer', blocking: true, needs: [] }, { id: 'ax-scan', kind: 'agent', role: 'security', blocking: false, needs: ['plan'] }])
  expect(w.graph(wf).nodes.find((n) => n.id === 'build')?.jobs).toBeUndefined()
})
