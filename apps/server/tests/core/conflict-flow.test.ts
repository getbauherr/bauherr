import { describe, expect, it } from 'vitest'
import { contextPack } from '../../src/core/run/pack'
import { fold } from '../../src/core/lifecycle'
import { readEvents } from '../../src/core/record/store'
import { buildResult, BRIEF, flowHarness } from './modules-harness'

const f = flowHarness('core_conflict_flow')

describe('a pull request that conflicts after Build submitted it', () => {
  it('goes back to Build with the note, and the rebased patch is reviewed, verified and merged', async () => {
    const s = await f.toVerify()
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'agents' })

    f.fake().commit(s.repo, 'main', 'other.txt', 'moved')
    f.fake().setMergeable(s.repo, s.pull.number, false)
    await s.sync()

    expect(await f.view(s.id)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
    const types = await f.types(s.id)
    expect(types).toContain('pull.conflicted')
    expect(types).not.toContain('verify.changes')
    const builder = await f.claimRun(s.id, 'builder')
    const pack = await contextPack(f.subDeps(), builder.run)
    expect(pack.note).toBe(
      'The pull request conflicts with main. Rebase onto it, resolve the conflicts, run the checks and ' +
        'submit again. Do not change anything else.',
    )

    const rebased = await f.pullFor(s.repo, 'fix', 'b.txt')
    f.fake().setMergeable(s.repo, s.pull.number, true)
    await f.submitTo(builder, buildResult(rebased.number, rebased.headSha, 'p2'))
    await s.sync()
    const head = (await f.fake().forge.getPullRequest(s.repo, rebased.number)).headSha
    f.green(s.repo, head)
    await s.sync()
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'agents' })

    await f.work(s.id, 'reviewer', { headSha: head, patchId: 'p2', findings: [] })
    const proofs = await Promise.all(['c1', 'c2', 'c3'].map((c) => f.proof(s.id, c)))
    const criteria = ['c1', 'c2', 'c3'].map((id, i) => ({ id, status: 'met', proof: [proofs[i]] }))
    const verdict = {
      headSha: head,
      patchId: 'p2',
      criteria,
      findings: [],
      verdict: 'pass',
      changes: [],
      walkthrough: [],
      notVerified: [],
    }
    await f.work(s.id, 'verifier', verdict)

    expect(await f.types(s.id)).toContain('pull.updated')
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    expect(await f.types(s.id)).toContain('ship.merged')
    expect((await f.fake().forge.getPullRequest(s.repo, s.pull.number)).state).toBe('merged')
  })

  it('sends a conflicting patch back to Build before any review starts, without a verify round', async () => {
    const s = await f.start('active')
    await f.work(s.id, 'builder', { outcome: 'accepted', type: 'bug', reason: 'clear' })
    await f.work(s.id, 'builder', BRIEF)
    const pull = await f.pullFor(s.repo, 'fix', 'a.txt')
    f.fake().commit(s.repo, 'main', 'a.txt', 'main-a')
    await s.sync()
    await f.work(s.id, 'builder', buildResult(pull.number, pull.headSha, 'p1'))

    const types = await f.types(s.id)
    expect(types).toContain('pull.conflicted')
    expect(types).not.toContain('verify.changes')
    expect(types.filter((type) => type === 'run.started')).toHaveLength(4)
    expect(fold(await readEvents(f.h.payload(), s.id))).toMatchObject({ stage: 'build', verifyRounds: 0 })
  })
})
