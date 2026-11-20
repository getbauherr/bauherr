import { describe, expect, it } from 'vitest'
import { gate, type GateFacts } from '../../src/core/gate'
import type { Finding } from '../../src/core/record/schema'
import type { VerifyResult } from '../../src/core/verify-result'
import { briefed, criterion } from './fixtures'

const record = briefed({
  criteria: [criterion(1), criterion(2, { verify: { kind: 'screenshot', how: 'look' } }), criterion(3)],
})

const facts: GateFacts = {
  buildClaimedBy: 'session-build',
  verifyHeldBy: 'session-verify',
  patch: { id: 'p1', headSha: 'h1' },
  headCommit: 'h1',
  checks: 'passed',
  proofIds: ['11', '12', '13'],
}

const finding = (extra: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  axis: 'spec',
  text: 'the filter drops rows',
  evidence: { kind: 'repro', pointer: 'open /list, filter by x' },
  status: 'fixed',
  ...extra,
})

const passing = (extra: Partial<VerifyResult> = {}): VerifyResult => ({
  headSha: 'h1',
  patchId: 'p1',
  criteria: [
    { id: 'c1', status: 'met', proof: ['11'] },
    { id: 'c2', status: 'met', proof: ['12'] },
    { id: 'c3', status: 'met', proof: ['13'] },
  ],
  findings: [],
  verdict: 'pass',
  changes: [],
  walkthrough: [],
  notVerified: [],
  ...extra,
})

const refused = (result: VerifyResult, change: Partial<GateFacts> = {}, rule?: string) => {
  const outcome = gate({ result, record, facts: { ...facts, ...change } })
  expect(outcome.accepted).toBe(false)
  if (outcome.accepted) return
  expect(outcome.refusals.map((r) => r.message).join(' ')).toContain(rule ?? '')
  return outcome.refusals
}

describe('the verification gate', () => {
  it('accepts a verdict by another session on the latest patch with proof', () => {
    expect(gate({ result: passing(), record, facts })).toEqual({ accepted: true })
  })

  it('refuses a verdict by the session that built the patch', () => {
    refused(passing(), { verifyHeldBy: 'session-build' }, 'author')
  })

  it('refuses a stale patch id', () => {
    refused(passing({ patchId: 'p0' }), {}, 'stale-patch')
  })

  it('refuses a head commit that is not the latest patch head', () => {
    refused(passing({ headSha: 'h0' }), {}, 'stale-patch')
  })

  it('refuses a result when the head of the pull request moved', () => {
    refused(passing(), { headCommit: 'h2' }, 'head-moved')
    refused(passing(), { headCommit: null }, 'head-moved')
  })

  it.each(['pending', 'failed'] as const)('refuses met on a test criterion while the checks are %s', (checks) => {
    refused(passing(), { checks }, 'checks')
  })

  it('lets a criterion of another kind be met while the checks are red', () => {
    const result = passing({ criteria: [{ id: 'c2', status: 'met', proof: ['12'] }], verdict: 'changes' })
    const open = { ...record, criteria: [record.criteria[1] ?? criterion(2)] }
    expect(gate({ result, record: open, facts: { ...facts, checks: 'failed' } })).toEqual({ accepted: true })
  })

  it('accepts a test criterion when the Product has no required checks', () => {
    expect(gate({ result: passing(), record, facts: { ...facts, checks: 'none' } })).toEqual({ accepted: true })
  })

  it('refuses met or partial without proof', () => {
    const result = passing({ criteria: [{ id: 'c1', status: 'partial', proof: [] }], verdict: 'changes' })
    refused(result, {}, 'proof')
  })

  it('refuses a proof that does not exist or belongs to another record', () => {
    const result = passing({ criteria: [{ id: 'c1', status: 'met', proof: ['99'] }], verdict: 'changes' })
    refused(result, {}, 'proof')
  })

  it.each([
    ['open criterion', { criteria: [{ id: 'c1', status: 'open' as const, proof: [] }] }],
    ['missing criterion', { criteria: [{ id: 'c1', status: 'missing' as const, proof: [] }] }],
    ['open finding', { findings: [finding({ status: 'open' })] }],
    ['fixing finding', { findings: [finding({ status: 'fixing' })] }],
  ])('refuses pass with an %s', (_name, change) => {
    refused(passing(change), {}, 'verdict')
  })

  it('refuses pass while a criterion is not part of the result and still open', () => {
    refused(passing({ criteria: [{ id: 'c1', status: 'met', proof: ['11'] }] }), {}, 'verdict')
  })

  it('refuses a finding without an evidence pointer', () => {
    const bad = finding({ evidence: { kind: 'test', pointer: ' ' } })
    refused(passing({ findings: [bad], verdict: 'changes' }), {}, 'evidence')
  })

  it('refuses a criterion that is not in the record', () => {
    refused(passing({ criteria: [{ id: 'c9', status: 'met', proof: ['11'] }], verdict: 'changes' }), {}, 'criterion')
  })

  it('lists every refusal at once', () => {
    const refusals = refused(passing({ patchId: 'p0' }), { verifyHeldBy: 'session-build' })
    expect(refusals).toHaveLength(2)
  })
})
