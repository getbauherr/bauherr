import { describe, expect, it } from 'vitest'
import { enterIssues } from '../../src/core/intake/enter'
import { advance } from '../../src/core/engine'
import { fold } from '../../src/core/lifecycle'
import { appendEvent, readEvents } from '../../src/core/record/store'
import { readerOf } from './mirror-harness'
import { buildResult, BRIEF, flowHarness, FORM } from './modules-harness'

const f = flowHarness('core_stacked_ship_flow')

const ACCEPTED = { outcome: 'accepted', type: 'bug', reason: 'clear' }

const passing = async (id: number, headSha: string, patchId: string) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(id, criterion)] })
  }
  return { headSha, patchId, criteria, findings: [], verdict: 'pass', changes: [], walkthrough: [], notVerified: [] }
}

const stackedPair = async () => {
  const s = await f.start('active')
  const fake = f.fake()
  fake.actingAs = 'jo'
  await fake.tickets(s.repo).create({ title: 'the base', body: FORM })
  fake.actingAs = 'factory'
  await f.h.settle({ [s.repo]: readerOf(fake) })
  const [baseId] = await enterIssues(f.subDeps())
  if (baseId === undefined) throw new Error('the base was not entered')
  for (const stage of [ACCEPTED, BRIEF]) {
    for (const id of [s.id, baseId]) await f.work(id, 'builder', stage)
  }
  const base = await f.pullFor(s.repo, 'base-branch', 'a.txt')
  await fake.forge.createBranch(s.repo, 'child-branch', 'base-branch')
  const childHead = fake.commit(s.repo, 'child-branch', 'b.txt', 'b-1')
  const open = { title: 'child', head: 'child-branch', base: 'base-branch' }
  const childPull = await fake.forge.openPullRequest(s.repo, open)
  await f.work(s.id, 'builder', buildResult(childPull.number, childHead, 'p1'))
  await f.work(baseId, 'builder', buildResult(base.number, base.headSha, 'p1'))
  await s.sync()
  f.green(s.repo, base.headSha)
  f.green(s.repo, childHead)
  await s.sync()
  return { ...s, baseId, child: s.id, base, childPull, childHead }
}

describe('a ticket built on another ticket branch', () => {
  it('waits for its base before it merges, then merges on the default branch', async () => {
    const p = await stackedPair()
    await f.work(p.child, 'verifier', await passing(p.child, p.childHead, 'p1'))
    expect(await f.types(p.child)).not.toContain('ship.merged')
    const waiting = await f.view(p.child)
    expect(waiting).toMatchObject({ stage: 'ship', waitingOn: 'nobody' })
    expect(waiting.parked).toContain('Waiting for')
    expect((await f.fake().forge.getPullRequest(p.repo, p.childPull.number)).state).toBe('open')

    await f.work(p.baseId, 'verifier', await passing(p.baseId, p.base.headSha, 'p1'))
    expect(await f.types(p.baseId)).toContain('ship.merged')
    expect((await f.fake().forge.getPullRequest(p.repo, p.childPull.number)).base).toBe('main')

    const head = (await f.fake().forge.getPullRequest(p.repo, p.childPull.number)).headSha
    f.green(p.repo, head)
    await p.sync()
    const state = fold(await readEvents(f.h.payload(), p.child))
    expect(state.verifyRounds).toBe(0)
    expect(await f.types(p.child)).toContain('ship.merged')
    expect((await f.fake().forge.getPullRequest(p.repo, p.childPull.number)).state).toBe('merged')
  })

  it('goes back to Build with a conflict when it cannot be brought up to date, without a verify round', async () => {
    const p = await stackedPair()
    await f.work(p.child, 'verifier', await passing(p.child, p.childHead, 'p1'))
    f.fake().commit(p.repo, 'main', 'b.txt', 'main-b')
    await f.work(p.baseId, 'verifier', await passing(p.baseId, p.base.headSha, 'p1'))
    expect(await f.types(p.child)).toContain('pull.conflicted')
    const state = fold(await readEvents(f.h.payload(), p.child))
    expect(state).toMatchObject({ stage: 'build', verifyRounds: 0, conflict: { patchId: 'p1', base: 'main' } })
    expect(await f.types(p.child)).not.toContain('verify.changes')
  })

  it('stops waiting when its base is discarded, and merges on the default branch', async () => {
    const p = await stackedPair()
    await f.work(p.child, 'verifier', await passing(p.child, p.childHead, 'p1'))
    expect(await f.types(p.child)).not.toContain('ship.merged')

    await appendEvent(f.h.payload(), p.baseId, { type: 'ticket.closed', data: { reason: 'discarded' }, actor: 'owner' })
    await advance(p.baseId, f.subDeps())

    expect(await f.types(p.child)).toContain('ship.merged')
    const pull = await f.fake().forge.getPullRequest(p.repo, p.childPull.number)
    expect(pull).toMatchObject({ state: 'merged', base: 'main' })
  })
})
