import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { finding, flowHarness, type Flow } from './modules-harness'

const f = flowHarness('core_verify_gate_flow')

const result = z.object({ status: z.string(), problems: z.array(z.object({ message: z.string() })).optional() })

type Verifying = Awaited<ReturnType<Flow['toVerify']>>

const body = async (s: Verifying, change: object) => {
  const proofs = await Promise.all(['c1', 'c2', 'c3'].map((c) => f.proof(s.id, c)))
  const criteria = ['c1', 'c2', 'c3'].map((id, i) => ({ id, status: 'met', proof: [proofs[i]] }))
  const base = {
    headSha: s.pull.headSha,
    patchId: 'p1',
    criteria,
    findings: [],
    verdict: 'pass',
    changes: [],
    walkthrough: [],
    notVerified: [],
  }
  return { ...base, ...change }
}

const verdict = async (s: Verifying, change: object, by = 'exec-verifier') =>
  result.parse(await f.work(s.id, 'verifier', await body(s, change), by))

const reviewed = async (s: Verifying) =>
  f.work(s.id, 'reviewer', { headSha: s.pull.headSha, patchId: 'p1', findings: [] })

const refusedBy = (outcome: z.infer<typeof result>, rule: string) => {
  expect(outcome.status).toBe('retry')
  expect(outcome.problems?.map((p) => p.message).join(' ')).toContain(`Gate ${rule}`)
}

describe('the gate in the flow', () => {
  it('accepts a proven verdict of a non-author', async () => {
    const s = await f.toVerify()
    expect((await verdict(s, {})).status).toBe('accepted')
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    expect(await f.types(s.id)).toContain('ship.merged')
  })

  it('refuses a verdict by the session that built the patch', async () => {
    const s = await f.toVerify()
    refusedBy(await verdict(s, {}, 'exec-builder'), 'author')
    expect((await f.view(s.id)).stage).toBe('verify')
  })

  it('refuses a stale patch id', async () => {
    const s = await f.toVerify()
    await reviewed(s)
    refusedBy(await verdict(s, { patchId: 'p0' }), 'stale-patch')
  })

  it('refuses met on a test criterion while the checks are red', async () => {
    const s = await f.toVerify('failure')
    refusedBy(await verdict(s, {}), 'checks')
  })

  it('refuses pass with an open finding', async () => {
    const s = await f.toVerify()
    refusedBy(await verdict(s, { findings: [finding('open')] }), 'verdict')
  })

  it('fails the run after the fix turn, and records the failure', async () => {
    const s = await f.toVerify()
    await reviewed(s)
    const claimed = await f.claimRun(s.id, 'verifier')
    const wrong = await body(s, { patchId: 'p0' })
    refusedBy(result.parse(await f.submitTo(claimed, wrong)), 'stale-patch')
    expect(result.parse(await f.submitTo(claimed, wrong)).status).toBe('failed')
    expect((await f.types(s.id)).filter((t) => t === 'run.failed')).toHaveLength(1)
  })
})
