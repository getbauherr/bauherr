import { describe, expect, it } from 'vitest'
import {
  briefReady,
  emptyRecord,
  RECORD_FIELDS,
  recordSchema,
  type TicketRecord,
} from '../../src/core/record/schema'
import { answered, briefed, criterion, decision, repeat, source } from './fixtures'

const ok = (r: unknown) => recordSchema.safeParse(r).success
const str = (n: number) => 'x'.repeat(n)
const base = (): TicketRecord => briefed()

describe('record schema', () => {
  it('accepts the empty record and a briefed record', () => {
    expect(ok(emptyRecord(source, 'change'))).toBe(true)
    expect(ok(base())).toBe(true)
  })

  it('names every top-level field', () => {
    expect([...RECORD_FIELDS].sort()).toEqual(Object.keys(base()).sort())
  })

  it('reads a stored feature as a change and knows the question type', () => {
    expect(recordSchema.parse({ ...base(), type: 'feature' }).type).toBe('change')
    expect(ok({ ...base(), type: 'question' })).toBe(true)
  })

  it('rejects another version and unknown types', () => {
    expect(ok({ ...base(), v: 2 })).toBe(false)
    expect(ok({ ...base(), type: 'epic' })).toBe(false)
  })

  it.each([
    ['goal', (n: number) => ({ goal: str(n) }), 300],
    ['handoff', (n: number) => ({ handoff: str(n) }), 1200],
    ['criterion text', (n: number) => ({ criteria: [criterion(1, { text: str(n) })] }), 160],
    [
      'criterion how',
      (n: number) => ({ criteria: [criterion(1, { verify: { kind: 'manual', how: str(n) } })] }),
      200,
    ],
    ['out of scope item', (n: number) => ({ outOfScope: [str(n)] }), 160],
    ['rollback', (n: number) => ({ risk: { door: 'one-way', areas: [], rollback: str(n) } }), 200],
    ['decision question', (n: number) => ({ decisions: [decision(1, { question: str(n) })] }), 200],
    [
      'option label',
      (n: number) => ({ decisions: [decision(1, { options: [{ id: 'a', label: str(n) }, { id: 'b', label: 'B' }] })] }),
      80,
    ],
    ['plan step', (n: number) => ({ plan: { steps: [str(n)] } }), 160],
    [
      'finding text',
      (n: number) => ({
        findings: [{ id: 'f1', axis: 'spec', text: str(n), evidence: { kind: 'test', pointer: 'p' }, status: 'open' }],
      }),
      300,
    ],
    [
      'finding pointer',
      (n: number) => ({
        findings: [{ id: 'f1', axis: 'spec', text: 't', evidence: { kind: 'repro', pointer: str(n) }, status: 'open' }],
      }),
      200,
    ],
  ] as const)('limits %s to its length', (_name, make, max) => {
    expect(ok({ ...base(), ...make(max) })).toBe(true)
    expect(ok({ ...base(), ...make(max + 1) })).toBe(false)
  })

  const result = (extra: Record<string, unknown>) => ({
    changes: [],
    walkthrough: [],
    notVerified: [],
    cost: { usd: 0, runs: 0, minutes: 0 },
    ...extra,
  })

  it.each([
    ['change text', (n: number) => result({ changes: [{ text: str(n), tag: 'visible' }] }), 160],
    ['walkthrough item', (n: number) => result({ walkthrough: [str(n)] }), 160],
    ['not verified item', (n: number) => result({ notVerified: [str(n)] }), 160],
  ] as const)('limits the result %s', (_name, make, max) => {
    expect(ok({ ...base(), result: make(max) })).toBe(true)
    expect(ok({ ...base(), result: make(max + 1) })).toBe(false)
  })

  it.each([
    ['criteria', (n: number) => ({ criteria: repeat(n, (i) => criterion(i)) }), 7],
    ['out of scope', (n: number) => ({ outOfScope: repeat(n, (i) => `s${i}`) }), 5],
    ['risk areas', (n: number) => ({ risk: { door: 'two-way', areas: repeat(n, (i) => `a${i}`), rollback: 'r' } }), 5],
    ['decisions', (n: number) => ({ decisions: repeat(n, (i) => decision(i)) }), 12],
    ['plan steps', (n: number) => ({ plan: { steps: repeat(n, (i) => `s${i}`) } }), 7],
    [
      'findings',
      (n: number) => ({
        findings: repeat(n, (i) => ({
          id: `f${i}`,
          axis: 'spec',
          text: 't',
          evidence: { kind: 'test', pointer: 'p' },
          status: 'open',
        })),
      }),
      20,
    ],
    [
      'result changes',
      (n: number) => ({ result: result({ changes: repeat(n, () => ({ text: 't', tag: 'internal' })) }) }),
      5,
    ],
    ['result walkthrough', (n: number) => ({ result: result({ walkthrough: repeat(n, () => 'w') }) }), 5],
    ['result not verified', (n: number) => ({ result: result({ notVerified: repeat(n, () => 'n') }) }), 5],
  ] as const)('limits the number of %s', (_name, make, max) => {
    expect(ok({ ...base(), ...make(max) })).toBe(true)
    expect(ok({ ...base(), ...make(max + 1) })).toBe(false)
  })

  it('limits the options of a decision to 2 through 4', () => {
    const withOptions = (n: number) =>
      decision(1, { options: repeat(n, (i) => ({ id: `o${i}`, label: 'L' })), recommended: 'o1' })
    expect(ok({ ...base(), decisions: [withOptions(1)] })).toBe(false)
    expect(ok({ ...base(), decisions: [withOptions(2)] })).toBe(true)
    expect(ok({ ...base(), decisions: [withOptions(4)] })).toBe(true)
    expect(ok({ ...base(), decisions: [withOptions(5)] })).toBe(false)
  })

  it('trims strings and refuses blank ones, except the goal and the handoff', () => {
    expect(recordSchema.parse({ ...base(), goal: '  hi  ' }).goal).toBe('hi')
    expect(ok({ ...base(), goal: '   ' })).toBe(true)
    expect(ok({ ...base(), handoff: '' })).toBe(true)
    expect(ok({ ...base(), outOfScope: ['  '] })).toBe(false)
    expect(ok({ ...base(), source: { ...source, repo: ' ' } })).toBe(false)
  })

  it('validates the source and the criterion shape', () => {
    expect(ok({ ...base(), source: { ...source, number: 0 } })).toBe(false)
    expect(ok({ ...base(), source: { ...source, number: 1.5 } })).toBe(false)
    expect(ok({ ...base(), source: { ...source, forge: 'bitbucket' } })).toBe(false)
    expect(ok({ ...base(), criteria: [{ ...criterion(1), status: 'done' }] })).toBe(false)
    expect(ok({ ...base(), criteria: [{ ...criterion(1), id: 'x1' }] })).toBe(false)
    expect(ok({ ...base(), criteria: [criterion(1, { proof: ['p1'] })] })).toBe(true)
  })

  it('validates the result cost', () => {
    expect(ok({ ...base(), result: result({ cost: { usd: -0.01, runs: 0, minutes: 0 } }) })).toBe(false)
    expect(ok({ ...base(), result: result({ cost: { usd: 0.5, runs: 1.5, minutes: 0 } }) })).toBe(false)
    expect(ok({ ...base(), result: result({ cost: { usd: 0.5, runs: 2, minutes: 3 } }) })).toBe(true)
  })

  it('keeps ids unique within criteria, decisions and findings', () => {
    expect(ok({ ...base(), criteria: [criterion(1), criterion(1)] })).toBe(false)
    expect(ok({ ...base(), decisions: [decision(1), decision(1)] })).toBe(false)
    const finding = { id: 'f1', axis: 'spec', text: 't', evidence: { kind: 'test', pointer: 'p' }, status: 'open' }
    expect(ok({ ...base(), findings: [finding, finding] })).toBe(false)
    expect(ok({ ...base(), criteria: [criterion(1)], decisions: [decision(1)] })).toBe(true)
  })

  describe('decision answers', () => {
    const withDecision = (d: unknown) => ok({ ...base(), decisions: [d] })

    it('are given together or not at all', () => {
      expect(withDecision(decision(1, answered))).toBe(true)
      expect(withDecision(decision(1))).toBe(true)
      expect(withDecision(decision(1, { answer: 'a' }))).toBe(false)
      expect(withDecision(decision(1, { by: 'owner', at: answered.at as string }))).toBe(false)
      expect(withDecision(decision(1, { answer: 'a', by: 'owner' }))).toBe(false)
    })

    it('name an option of the decision, as does the recommendation', () => {
      expect(withDecision(decision(1, { ...answered, answer: 'z' }))).toBe(false)
      expect(withDecision(decision(1, { recommended: 'z' }))).toBe(false)
    })

    it('are answered by the owner or the factory at an ISO time', () => {
      expect(withDecision(decision(1, { ...answered, by: 'factory' }))).toBe(true)
      expect(withDecision({ ...decision(1, answered), by: 'rule' })).toBe(false)
      expect(withDecision(decision(1, { ...answered, at: 'yesterday' }))).toBe(false)
    })
  })

  describe('briefReady', () => {
    const ready = (r: TicketRecord) => briefReady.safeParse(r)
    const paths = (r: TicketRecord) => {
      const parsed = ready(r)
      return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))
    }

    it('accepts a goal, 3 to 7 criteria and a risk', () => {
      expect(ready(base()).success).toBe(true)
      expect(ready(briefed({ criteria: repeat(7, (i) => criterion(i)) })).success).toBe(true)
    })

    it('refuses the empty record on every missing part', () => {
      expect(paths(emptyRecord(source, 'bug')).sort()).toEqual(['criteria', 'goal', 'risk'])
    })

    it('refuses 2 and 8 criteria', () => {
      expect(paths(briefed({ criteria: repeat(2, (i) => criterion(i)) }))).toEqual(['criteria'])
      expect(ready(briefed({ criteria: repeat(8, (i) => criterion(i)) })).success).toBe(false)
    })

    it('refuses a blank goal and a null risk', () => {
      expect(paths(briefed({ goal: ' ' }))).toEqual(['goal'])
      expect(paths(briefed({ risk: null }))).toEqual(['risk'])
    })
  })
})
