import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { matches } from '../src/lib/glob'
import { formatPathSets, neverRuns, parsePathSets } from '../src/lib/path-sets'
import { describeChanges } from '../src/lib/workflow-describe'
import * as e from '../src/lib/workflow-edit'
import { lint, skipTarget } from '../src/lib/workflow-rules'
import { evalWhen, whenText, type Facts, type When } from '../src/lib/workflow-when'

const pack = (f: string) => readFileSync(fileURLToPath(new URL(`../../../pack/${f}`, import.meta.url)), 'utf8')
const base = pack('factory.yaml')
const careful = pack('presets/careful.yaml')
const doc = (y: string) => {
  const d = e.readDraft(y)
  if (!d.ok) throw new Error(d.error)
  return d.doc
}
const findings = (y: string) => lint(doc(y))
const facts = (f: Partial<Facts> = {}): Facts => ({ paths: ['src/auth/login.ts'], labels: [], sets: { security: ['src/auth/**'], ui: ['src/app/**'] }, ...f })
const ev = (when: When, f?: Partial<Facts>) => evalWhen(when, facts(f), matches)
const withWhen = (stage: string, when: unknown) => {
  const d = doc(careful)
  e.stagesOf(d).find((s) => s.name === stage)!.when = when
  return lint(d)
}

describe('evalWhen', () => {
  it('touches matches a declared set against the changed paths', () => {
    expect(ev({ touches: 'security' })).toEqual({ match: true })
    expect(ev({ touches: 'ui' })).toEqual({ match: false, reason: 'the change touches no ui paths' })
  })
  it('several sets or globs match when any does; keys are AND-ed', () => {
    expect(ev({ touches: ['ui', 'security'] })).toEqual({ match: true })
    expect(ev({ paths: ['docs/**', 'src/auth/*.ts'] })).toEqual({ match: true })
    expect(ev({ touches: 'security', paths: ['docs/**'] })).toMatchObject({ match: false, reason: 'the change touches none of docs/**' })
    expect(ev({ touches: 'security', labels: ['urgent'] }, { labels: ['urgent'] })).toEqual({ match: true })
  })
  it('unknown changed paths match, except for a set the Product has not declared', () => {
    expect(ev({ touches: 'ui' }, { paths: null })).toEqual({ match: true })
    expect(ev({ paths: ['docs/**'] }, { paths: null })).toEqual({ match: true })
    expect(ev({ touches: 'security' }, { paths: null, sets: {} })).toEqual({ match: false, reason: 'the Product declares no security paths' })
    expect(ev({ touches: 'security' }, { paths: null, sets: { security: [] } })).toMatchObject({ match: false })
  })
  it('labels and request types read the Ticket labels', () => {
    expect(ev({ labels: ['a', 'b'] }, { labels: ['b'] })).toEqual({ match: true })
    expect(ev({ labels: ['a'] })).toMatchObject({ match: false })
    expect(ev({ types: ['bug', 'feature'] }, { labels: ['bauherr:type:feature'] })).toEqual({ match: true })
    expect(ev({ types: ['bug'] }, { labels: ['bauherr:type:feature'] })).toEqual({ match: false, reason: 'the request is not a bug' })
    expect(ev({ types: ['bug'] })).toMatchObject({ match: false })
  })
  it('says a condition in plain words', () => {
    expect(whenText({ touches: 'security' })).toBe('Only when the change touches security paths')
    expect(whenText({ types: ['bug'] })).toBe('Only for bugs')
    expect(whenText({ touches: ['ui', 'security'], types: ['bug'] })).toBe('Only when the change touches ui paths or security paths and the request is a bug')
  })
})

describe('lint of when and skip_to', () => {
  it('the shipped presets are clean', () => {
    expect(findings(careful)).toEqual([])
    expect(findings(pack('presets/standard.yaml'))).toEqual([])
  })
  it('when only on agent and human stages', () => {
    const d = doc(base)
    e.stagesOf(d).find((s) => s.name === 'build')!.when = { touches: 'security' }
    expect(lint(d)).toContain('stage "build": when is only allowed on agent and human stages')
  })
  it('known keys, non-empty, valid values', () => {
    expect(withWhen('ux-review', {})).toContain('stage "ux-review": when must name at least one of touches, paths, labels, types')
    expect(withWhen('ux-review', { touch: 'ui' })[0]).toMatch(/unknown key "touch"/)
    expect(withWhen('ux-review', { types: ['epic'] })[0]).toMatch(/types must be a non-empty list of bug, feature, change, question/)
    expect(withWhen('ux-review', { paths: [] })[0]).toMatch(/paths must be a non-empty list/)
    expect(withWhen('ux-review', { touches: 'Not A Name' })[0]).toMatch(/touches must be a path set name/)
    expect(withWhen('ux-review', { touches: ['ui', 'security'], paths: ['x/**'], labels: ['l'], types: ['bug'] })).toEqual([])
  })
  it('skip_to needs a when and a stage the rules allow', () => {
    const set = (stage: string, k: string, v: unknown) => {
      const d = doc(careful)
      e.stagesOf(d).find((s) => s.name === stage)![k] = v
      return lint(d)
    }
    expect(set('ux-review', 'skip_to', 'review')).toEqual([])
    expect(set('ux-review', 'skip_to', 'nowhere')[0]).toMatch(/must be a stage/)
    expect(set('ux-review', 'skip_to', 'release')[0]).toMatch(/cannot go to the release stage/)
    expect(set('security-review', 'skip_to', 'release')).toEqual(['stage "security-review": a skipped ticket cannot go to the release stage "release"'])
    expect(set('build', 'skip_to', 'review')).toContain('stage "build": skip_to needs a when')
  })
  it('the pass outcome is the first in file order unless skip_to says otherwise', () => {
    expect(skipTarget({ outcomes: { findings: 'build', pass: 'review' } })).toBe('build')
    expect(skipTarget({ outcomes: { pass: 'review', findings: 'build' }, skip_to: 'build' })).toBe('build')
  })
  it('a conditional cycle is refused', () => {
    const d = doc(careful)
    const s = e.stagesOf(d)
    s.find((x) => x.name === 'ux-review')!.skip_to = 'security-review'
    s.find((x) => x.name === 'security-review')!.skip_to = 'ux-review'
    expect(lint(d).some((f) => /skip in a cycle/.test(f))).toBe(true)
  })
})

describe('editing', () => {
  it('setWhen sets and clears the condition, keeping the file valid', () => {
    const y = e.setWhen(base, 'build', { touches: 'security' })
    expect(findings(y).length).toBeGreaterThan(0)
    const added = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security review', role: 'security', skill: 'mr-security-review', when: { touches: 'security' } })
    expect(findings(added.yaml)).toEqual([])
    expect(e.stagesOf(doc(added.yaml)).find((s) => s.name === added.name)!.when).toEqual({ touches: 'security' })
    const cleared = e.setWhen(added.yaml, added.name, undefined)
    expect(e.stagesOf(doc(cleared)).find((s) => s.name === added.name)!.when).toBeUndefined()
    expect(e.stagesOf(doc(e.setWhen(cleared, added.name, { types: ['bug'] }))).find((s) => s.name === added.name)!.when).toEqual({ types: ['bug'] })
  })
  it('describeChanges names the condition', () => {
    const added = e.addStep(base, { after: 'build', kind: 'agent', title: 'Security review', role: 'security', skill: 'mr-security-review' })
    expect(describeChanges(doc(added.yaml), doc(e.setWhen(added.yaml, added.name, { touches: 'security' })))).toEqual(['Security review now runs only when the change touches security paths'])
    expect(describeChanges(doc(careful), doc(e.setWhen(careful, 'security-review', undefined)))).toEqual(['Security review now runs for every ticket'])
    expect(describeChanges(doc(base), doc(e.addStep(base, { after: 'build', kind: 'agent', title: 'Test review', role: 'test', skill: 'test-review', when: { types: ['bug'] } }).yaml))[0]).toMatch(/only for bugs$/)
  })
})

describe('path sets', () => {
  it('round-trip through the textarea', () => {
    const sets = parsePathSets('security: src/auth/**, src/api/**\nui:\n\n')
    expect(sets).toEqual({ security: ['src/auth/**', 'src/api/**'], ui: [] })
    expect(parsePathSets(formatPathSets(sets))).toEqual(sets)
  })
  it('rejects a bad name, a duplicate and a path with a space', () => {
    expect(() => parsePathSets('Security: a')).toThrow(/not a set name/)
    expect(() => parsePathSets('a: x\na: y')).toThrow(/listed twice/)
    expect(() => parsePathSets('a: x y')).toThrow(/commas/)
  })
  it('names the steps that never run for a Product', () => {
    const wf = { stages: e.stagesOf(doc(careful)) } as never
    expect(neverRuns(wf, {}).map((x) => [x.title, x.names])).toEqual([['Security review', ['security']], ['UX review', ['ui']]])
    expect(neverRuns(wf, { security: ['a/**'], ui: [] }).map((x) => x.stage)).toEqual(['ux-review'])
  })
})
