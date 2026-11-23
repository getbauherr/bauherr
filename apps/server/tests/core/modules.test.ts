import { describe, expect, it } from 'vitest'
import { initialState } from '../../src/core/fold'
import { questionsBody } from '../../src/core/intake/questions'
import type { ApplyContext } from '../../src/core/module'
import { InvalidPatch } from '../../src/core/record/errors'
import { briefReady, recordSchema, type Finding, type TicketRecord } from '../../src/core/record/schema'
import type { Run } from '../../src/core/run/schema'
import { MODULES } from '../../src/lean'
import { briefed, CONFIG, criterion } from './fixtures'

const run: Run = {
  id: 9,
  recordId: 1,
  stage: 'build',
  role: 'builder',
  status: 'claimed',
  fingerprint: 'fp',
  attempt: 0,
  leasedBy: 's',
  leaseExpiresAt: null,
  steps: [],
  result: null,
  error: null,
  costUsd: null,
  context: null,
}

const context = (change: Partial<ApplyContext['config']> = {}, rounds = 0): ApplyContext => ({
  config: { ...CONFIG, ...change },
  state: { ...initialState(), reporter: { rounds, waiting: false, reminded: false } },
})

type Stage = 'intake' | 'brief' | 'build' | 'verify'

const apply = (stage: Stage, record: TicketRecord, result: unknown, ctx = context()) => {
  const module = MODULES[stage]
  if (!module) throw new Error('no module')
  return module.apply(record, result, run, ctx)
}

const finding = (id: string, status: Finding['status']): Finding => ({
  id,
  axis: 'spec',
  text: 'rows are dropped',
  evidence: { kind: 'repro', pointer: 'open the list' },
  status,
})

describe('the intake module', () => {
  const base = { type: 'bug', reason: 'clear enough' }
  const ask = { text: 'a', suggested: 'b' }

  it('accepts', () => {
    const applied = apply('intake', briefed(), { ...base, outcome: 'accepted', type: 'feature' })
    expect(applied.patch).toEqual({ type: 'feature' })
    expect(applied.events).toEqual([{ type: 'intake.accepted', data: {} }])
    expect(applied.effects).toBeUndefined()
  })

  it('asks the next round with numbered questions and a question effect', () => {
    const questions = [
      { text: 'Which browser?', suggested: 'Firefox' },
      { text: 'Since when?', suggested: 'last week' },
    ]
    const applied = apply('intake', briefed(), { ...base, outcome: 'needs-info', questions }, context({}, 1))
    expect(applied.events).toEqual([{ type: 'intake.asked', data: { round: 2 } }])
    expect(applied.effects).toEqual([{ kind: 'question', body: questionsBody(2, questions) }])
    expect(questionsBody(2, questions)).toContain('1. Which browser?\n   Suggested: Firefox')
  })

  it.each([
    ['not-planned', 'not-planned', 'not_planned'],
    ['not-a-bug', 'not-a-bug', 'not_planned'],
  ] as const)('closes as %s and closes on the forge when autoClose is on', (outcome, reason, forge) => {
    const applied = apply('intake', briefed(), { ...base, outcome })
    expect(applied.events).toEqual([{ type: 'intake.closed', data: { reason } }])
    expect(applied.effects?.map((e) => e.kind)).toEqual(['question', 'close'])
    expect(applied.effects?.[1]).toEqual({ kind: 'close', reason: forge })
  })

  it('does not close on the forge when autoClose is off', () => {
    const duplicate = { ...base, outcome: 'duplicate', duplicateOf: 4 }
    const applied = apply('intake', briefed(), duplicate, context({ autoClose: false }))
    expect(applied.effects).toEqual([{ kind: 'question', body: expect.stringContaining('#4') as string }])
  })

  it('disputes', () => {
    expect(apply('intake', briefed(), { ...base, outcome: 'disputed' }).events).toEqual([
      { type: 'intake.disputed', data: {} },
    ])
  })

  it.each([
    ['needs-info without questions', { outcome: 'needs-info' }],
    ['questions on an accepted issue', { outcome: 'accepted', questions: [ask] }],
    ['duplicate without a number', { outcome: 'duplicate' }],
    ['six questions', { outcome: 'needs-info', questions: Array.from({ length: 6 }, () => ask) }],
    ['a reason over 300', { outcome: 'accepted', reason: 'x'.repeat(301) }],
  ])('refuses %s', (_name, change) => {
    expect(() => apply('intake', briefed(), { ...base, ...change })).toThrow()
  })
})

describe('the brief module', () => {
  const result = {
    goal: 'Show the total',
    criteria: [1, 2, 3].map((n) => ({ text: `c ${n}`, verify: { kind: 'test', how: 'a test' } })),
    outOfScope: ['export'],
    visible: true,
    risk: { door: 'two-way', areas: [], rollback: 'revert' },
    decisions: [],
    plan: ['one'],
  }

  it('writes exactly the brief fields and the record is ready', () => {
    const applied = apply('brief', briefed({ goal: '', criteria: [], risk: null }), result)
    expect(Object.keys(applied.patch).sort()).toEqual(MODULES.brief?.writes.slice().sort())
    expect(applied.events).toEqual([{ type: 'brief.submitted', data: { runId: '9' } }])
    const merged = { ...briefed({ goal: '', criteria: [], risk: null }), ...applied.patch }
    expect(briefReady.safeParse(merged).success).toBe(true)
    expect(applied.patch.visible).toBe(true)
    expect(applied.patch.criteria?.map((c) => [c.id, c.status, c.proof])).toEqual([
      ['c1', 'open', []],
      ['c2', 'open', []],
      ['c3', 'open', []],
    ])
  })

  it.each([
    ['two criteria', { criteria: result.criteria.slice(0, 2) }],
    ['eight criteria', { criteria: Array.from({ length: 8 }, () => result.criteria[0]) }],
    ['a criterion with a status', { criteria: result.criteria.map((c) => ({ ...c, status: 'met' })) }],
    ['no risk', { risk: undefined }],
    ['no visible', { visible: undefined }],
  ])('refuses %s', (_name, change) => {
    expect(() => apply('brief', briefed(), { ...result, ...change })).toThrow()
  })
})

describe('the build module', () => {
  const selfCheck = [1, 2, 3].map((n) => ({ criterion: `c${n}`, status: 'met', pointer: 'src/a.ts' }))
  const result = { pr: 12, headSha: 'h1', patchId: 'p1', selfCheck, handoff: 'Read the PR, run x.' }

  it('writes the handoff and submits the patch', () => {
    const applied = apply('build', briefed(), result)
    expect(applied.patch).toEqual({ handoff: 'Read the PR, run x.', findings: [] })
    expect(applied.events).toEqual([
      { type: 'build.submitted', data: { runId: '9', patchId: 'p1', headSha: 'h1', pr: 12 } },
    ])
  })

  it('sets addressed open findings to fixing and leaves the rest', () => {
    const record = briefed({ findings: [finding('f1', 'open'), finding('f2', 'open'), finding('f3', 'invalid')] })
    const applied = apply('build', record, { ...result, addressed: ['f1', 'f3'] })
    expect(applied.patch.findings?.map((f) => f.status)).toEqual(['fixing', 'open', 'invalid'])
  })

  it('refuses a selfCheck that does not cover each criterion once', () => {
    expect(() => apply('build', briefed(), { ...result, selfCheck: selfCheck.slice(1) })).toThrow(InvalidPatch)
  })

  it('refuses an unknown addressed finding', () => {
    expect(() => apply('build', briefed(), { ...result, addressed: ['f9'] })).toThrow(InvalidPatch)
  })
})

describe('the verify module', () => {
  const result = {
    headSha: 'h1',
    patchId: 'p1',
    criteria: [
      { id: 'c1', status: 'met', proof: ['11'] },
      { id: 'c2', status: 'partial', proof: ['12'] },
    ],
    findings: [finding('f2', 'open')],
    verdict: 'changes',
    changes: [{ text: 'filter added', tag: 'visible' }],
    walkthrough: ['open the list'],
    notVerified: ['mobile'],
  }
  const record = briefed({ findings: [finding('f1', 'fixing')] })

  it('records criteria, merges findings and the result, and answers changes', () => {
    const applied = apply('verify', record, result)
    expect(applied.patch.criteria?.map((c) => [c.id, c.status, c.proof])).toEqual([
      ['c1', 'met', ['11']],
      ['c2', 'partial', ['12']],
      ['c3', 'open', []],
    ])
    expect(applied.patch.findings?.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(applied.patch.result).toMatchObject({ walkthrough: ['open the list'], cost: { usd: 0 } })
    expect(applied.events).toEqual([{ type: 'verify.changes', data: { runId: '9', patchId: 'p1' } }])
    expect(recordSchema.safeParse({ ...record, ...applied.patch }).success).toBe(true)
  })

  it('updates a known finding in place and answers pass', () => {
    const settled = { ...result, findings: [finding('f1', 'fixed')], verdict: 'pass' }
    const applied = apply('verify', record, settled)
    expect(applied.patch.findings?.map((f) => f.status)).toEqual(['fixed'])
    expect(applied.events).toEqual([{ type: 'verify.passed', data: { runId: '9', patchId: 'p1', headSha: 'h1' } }])
  })

  it('is gated and lists its writes', () => {
    expect(MODULES.verify?.gated).toBe(true)
    expect(MODULES.verify?.writes).toEqual(['criteria', 'findings', 'result'])
    expect(MODULES.verify?.role).toBe('verifier')
    expect(criterion(1).id).toBe('c1')
  })
})
