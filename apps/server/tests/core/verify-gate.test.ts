import { describe, expect, it } from 'vitest'
import { gate, reviewGate, type GateFacts } from '../../src/core/gate'
import type { Finding } from '../../src/core/record/schema'
import type { ReviewResult } from '../../src/core/review-result'
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
  screens: [],
  shots: [],
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

describe('a verdict after a review', () => {
  const held = (status: Finding['status']) => ({ ...record, findings: [finding({ status })] })
  const verdictOn = (status: Finding['status'], result: VerifyResult = passing()) =>
    gate({ result, record: held(status), facts })

  it.each(['open', 'fixing'] as const)('refuses pass while a finding of the review is %s', (status) => {
    const outcome = verdictOn(status)
    expect(outcome.accepted).toBe(false)
    if (!outcome.accepted) expect(outcome.refusals.map((r) => r.message).join(' ')).toContain('Gate verdict')
  })

  it.each(['fixed', 'invalid'] as const)('accepts pass once a finding of the review is %s', (status) => {
    expect(verdictOn(status)).toEqual({ accepted: true })
  })

  it('accepts pass when the verifier settles an open finding as invalid in the same result', () => {
    const result = passing({ findings: [finding({ status: 'invalid' })] })
    expect(verdictOn('open', result)).toEqual({ accepted: true })
  })
})

describe('the review gate', () => {
  const review = (extra: Partial<ReviewResult> = {}): ReviewResult => ({
    headSha: 'h1',
    patchId: 'p1',
    findings: [],
    ...extra,
  })
  const refusedReview = (result: ReviewResult, change: Partial<GateFacts>, rule: string) => {
    const outcome = reviewGate({ result, facts: { ...facts, ...change } })
    expect(outcome.accepted).toBe(false)
    if (!outcome.accepted) expect(outcome.refusals.map((r) => r.message).join(' ')).toContain(`Gate ${rule}`)
  }

  it('accepts a review by another session of the latest patch, with open findings', () => {
    const open = finding({ status: 'open' })
    expect(reviewGate({ result: review({ findings: [open] }), facts })).toEqual({ accepted: true })
  })

  it('does not apply the checks, proof and verdict rules', () => {
    const open = finding({ status: 'open' })
    expect(reviewGate({ result: review({ findings: [open] }), facts: { ...facts, checks: 'pending' } })).toEqual({
      accepted: true,
    })
  })

  it('refuses a review by the session that built the patch', () => {
    refusedReview(review(), { verifyHeldBy: 'session-build' }, 'author')
  })

  it('refuses a review of a stale patch', () => {
    refusedReview(review({ patchId: 'p0' }), {}, 'stale-patch')
    refusedReview(review({ headSha: 'h0' }), {}, 'stale-patch')
  })

  it('refuses a review when the head of the pull request moved', () => {
    refusedReview(review(), { headCommit: 'h2' }, 'head-moved')
  })

  it('refuses a finding without an evidence pointer', () => {
    const bad = finding({ status: 'open', evidence: { kind: 'test', pointer: ' ' } })
    refusedReview(review({ findings: [bad] }), {}, 'evidence')
  })
})

describe('the before and after pairs', () => {
  const visible = { ...record, visible: true }
  const shot = (kind: 'before' | 'after', screen: string, width = 1280, sha = 'h1') => ({
    id: kind === 'before' ? 1 : 2,
    kind,
    screen,
    width,
    sha,
  })
  const outcomeOf = (change: Partial<GateFacts>, result = passing(), shown = visible) =>
    gate({ result, record: shown, facts: { ...facts, screens: ['List', 'Detail'], ...change } })
  const messages = (change: Partial<GateFacts>, result = passing(), shown = visible) => {
    const outcome = outcomeOf(change, result, shown)
    return outcome.accepted ? [] : outcome.refusals.map((r) => r.message)
  }
  const both = (screen: string) => [shot('before', screen), shot('after', screen)]

  it('accepts a pair for every mockup screen', () => {
    expect(outcomeOf({ shots: [...both('List'), ...both('Detail')] })).toEqual({ accepted: true })
  })

  it('accepts a pair at each width it was taken at', () => {
    const phone = [shot('before', 'List', 390), shot('after', 'List', 390)]
    expect(outcomeOf({ shots: [...both('List'), ...phone, ...both('Detail')] })).toEqual({ accepted: true })
  })

  it('names each screen without a pair and what to attach', () => {
    const found = messages({ shots: both('List').slice(0, 1) })
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('Screen "List" has no after picture at width 1280')
    expect(found[1]).toContain('Screen "Detail" has no before and no after picture')
  })

  it('names a missing before', () => {
    const found = messages({ shots: [shot('after', 'List'), ...both('Detail')] })
    expect(found).toEqual([expect.stringContaining('Screen "List" has no before picture at width 1280')])
  })

  it('refuses another width and an after that is not the head', () => {
    const wide = [shot('before', 'List', 390), shot('after', 'List')]
    const found = messages({ shots: [...wide, ...both('Detail')] })
    expect(found).toEqual([expect.stringContaining('width 390'), expect.stringContaining('width 1280')])
    const old = [shot('before', 'List'), shot('after', 'List', 1280, 'h0')]
    expect(messages({ shots: [...old, ...both('Detail')] })).toEqual([expect.stringContaining('pull request head')])
  })

  it('does not check a ticket that is not visible, or a verdict that is not a pass', () => {
    expect(outcomeOf({ shots: [] }, passing(), record)).toEqual({ accepted: true })
    const changes = passing({ verdict: 'changes' })
    expect(messages({ shots: [] }, changes).join(' ')).not.toContain('Gate pairs')
  })
})
