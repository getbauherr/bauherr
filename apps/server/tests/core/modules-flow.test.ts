import { describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { buildResult, BRIEF, finding, flowHarness } from './modules-harness'

const f = flowHarness('core_modules_flow')

const QUESTIONS = [
  { text: 'Which browser?', suggested: 'Firefox' },
  { text: 'Since when?', suggested: 'since the last update' },
]
const NEEDS_INFO = { outcome: 'needs-info', type: 'bug', reason: 'two facts are missing', questions: QUESTIONS }
const ACCEPTED = { outcome: 'accepted', type: 'bug', reason: 'clear now' }

const statusComments = async (repo: string) =>
  (await f.comments(repo)).filter((c) => c.body.includes('**Goal:**'))

const verifyResult = async (id: number, headSha: string, patchId: string, change: object) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(id, criterion)] })
  }
  const base = { headSha, patchId, criteria, findings: [], verdict: 'pass' }
  const empty = { changes: [], walkthrough: [], notVerified: [] }
  return { ...base, ...empty, ...change }
}

describe('an issue from the mirror to done with the real modules', () => {
  it('runs one question round, one Verify with changes, edits the status comment in place and merges', async () => {
    const s = await f.start('active')
    expect(await f.work(s.id, 'builder', NEEDS_INFO)).toEqual({ status: 'accepted' })
    const question = (await f.comments(s.repo)).at(-1)?.body ?? ''
    expect(question).toContain('Questions, round 1')
    expect(question).toContain('1. Which browser?\n   Suggested: Firefox')
    expect(await f.view(s.id)).toMatchObject({ stage: 'intake', waitingOn: 'reporter' })

    await f.backdateAsked(s.id)
    f.fake().actingAs = 'jo'
    await f.fake().tickets(s.repo).comment('1', 'yes')
    f.fake().actingAs = 'factory'
    await s.sync()
    expect(await f.types(s.id)).toContain('reporter.replied')

    await f.work(s.id, 'builder', ACCEPTED)
    await f.work(s.id, 'builder', BRIEF)
    expect(await statusComments(s.repo)).toHaveLength(1)
    expect((await f.view(s.id)).stage).toBe('build')

    const first = await f.pullFor(s.repo, 'fix', 'a.txt')
    await f.work(s.id, 'builder', buildResult(first.number, first.headSha, 'p1'))
    f.fake().setChecks(s.repo, first.headSha, [{ name: 'ci', status: 'in_progress', conclusion: null }])
    await s.sync()
    f.green(s.repo, first.headSha)
    await s.sync()
    const changes = await verifyResult(s.id, first.headSha, 'p1', { verdict: 'changes', findings: [finding('open')] })
    await f.work(s.id, 'verifier', changes)
    expect(await f.types(s.id)).toContain('verify.changes')
    expect((await f.view(s.id)).record.findings.map((x) => x.status)).toEqual(['open'])

    const second = await f.pullFor(s.repo, 'fix', 'b.txt')
    await f.work(s.id, 'builder', buildResult(second.number, second.headSha, 'p2', ['f1']))
    expect((await f.view(s.id)).record.findings.map((x) => x.status)).toEqual(['fixing'])
    f.fake().setChecks(s.repo, second.headSha, [{ name: 'ci', status: 'in_progress', conclusion: null }])
    await s.sync()
    f.green(s.repo, second.headSha)
    await s.sync()
    const pass = await verifyResult(s.id, second.headSha, 'p2', { findings: [finding('fixed')] })
    expect(await f.work(s.id, 'verifier', pass)).toEqual({ status: 'accepted' })
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    expect(await f.types(s.id)).toContain('ship.merged')

    const seq = (await f.view(s.id)).card?.seq ?? -1
    const owner = { id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] }
    await decide(s.id, owner, { ask: 'result', choice: 'accept', seq }, f.subDeps())
    expect((await f.view(s.id)).stage).toBe('done')
    const status = await statusComments(s.repo)
    expect(status).toHaveLength(1)
    expect(status[0]?.body).toContain('**done**')
    expect(status[0]?.body).toContain('**Criteria:** 3 of 3 met')
    expect((await f.fake().tickets(s.repo).get('1')).labels).toContain('bauherr:stage:done')
  })
})

describe('an observing Product', () => {
  it('reaches the Brief card and writes nothing to the forge', async () => {
    const s = await f.start('observing')
    await f.work(s.id, 'builder', NEEDS_INFO)
    await f.backdateAsked(s.id)
    f.fake().actingAs = 'jo'
    await f.fake().tickets(s.repo).comment('1', 'yes')
    f.fake().actingAs = 'factory'
    await s.sync()
    await f.work(s.id, 'builder', ACCEPTED)
    await f.work(s.id, 'builder', { ...BRIEF, risk: { door: 'one-way', areas: [], rollback: 'restore a backup' } })
    expect(await f.view(s.id)).toMatchObject({ stage: 'brief', waitingOn: 'owner', card: { card: 'brief' } })
    expect((await f.comments(s.repo)).map((c) => c.author)).toEqual(['jo'])
    expect((await f.fake().tickets(s.repo).get('1')).labels).toEqual([])
    const types = await f.types(s.id)
    expect(types).toContain('forge.write.failed')
    expect(types).not.toContain('forge.write.done')
  })
})
