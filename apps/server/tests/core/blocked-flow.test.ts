import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { advance } from '../../src/core/engine'
import { enterIssues } from '../../src/core/intake/enter'
import { fold } from '../../src/core/lifecycle'
import { appendEvent, readEvents } from '../../src/core/record/store'
import { readerOf } from './mirror-harness'
import { buildResult, BRIEF, flowHarness, FORM } from './modules-harness'

const f = flowHarness('core_blocked_flow')

const ACCEPTED = { outcome: 'accepted', type: 'bug', reason: 'clear' }

const blockedPair = async () => {
  const s = await f.start('active')
  const fake = f.fake()
  fake.actingAs = 'jo'
  await fake.tickets(s.repo).create({ title: 'the blocker', body: FORM })
  fake.actingAs = 'factory'
  await f.h.settle({ [s.repo]: readerOf(fake) })
  const [blocker] = await enterIssues(f.subDeps())
  if (blocker === undefined) throw new Error('the blocker was not entered')
  await fake.tickets(s.repo).addBlockedBy('1', '2')
  await f.h.settle({ [s.repo]: readerOf(fake) })
  await f.work(s.id, 'builder', ACCEPTED)
  await f.work(blocker, 'builder', ACCEPTED)
  await f.work(s.id, 'builder', BRIEF)
  await f.work(blocker, 'builder', BRIEF)
  return { ...s, blocked: s.id, blocker }
}

const buildRuns = async (recordId: number) =>
  (await f.h.rows(sql`SELECT 1 FROM "stage_runs" WHERE "record_id" = ${recordId} AND "stage" = 'build'`)).length

const verifyResult = async (id: number, headSha: string, patchId: string) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(id, criterion)] })
  }
  return { headSha, patchId, criteria, findings: [], verdict: 'pass', changes: [], walkthrough: [], notVerified: [] }
}

describe('a ticket blocked by another ticket', () => {
  it('runs Intake and Brief but does not start Build while the blocker is open', async () => {
    const p = await blockedPair()
    expect(await f.view(p.blocked)).toMatchObject({ stage: 'build', waitingOn: 'nobody', card: null })
    expect(await buildRuns(p.blocked)).toBe(0)
    expect(await f.types(p.blocked)).toEqual(expect.arrayContaining(['intake.accepted', 'brief.approved']))
    expect(await buildRuns(p.blocker)).toBe(1)
  })

  it('raises no question for the owner while it waits', async () => {
    const p = await blockedPair()
    await advance(p.blocked, f.subDeps())
    expect(await f.types(p.blocked)).not.toContain('question.asked')
    expect((await f.view(p.blocked)).card).toBeNull()
  })

  it('starts Build by itself when the blocker pull request is merged', async () => {
    const p = await blockedPair()
    const pull = await f.pullFor(p.repo, 'fix', 'a.txt')
    await f.work(p.blocker, 'builder', buildResult(pull.number, pull.headSha, 'p1'))
    await p.sync()
    f.green(p.repo, pull.headSha)
    await p.sync()
    expect(await buildRuns(p.blocked)).toBe(0)
    await f.work(p.blocker, 'verifier', await verifyResult(p.blocker, pull.headSha, 'p1'))
    expect(await f.types(p.blocker)).toContain('ship.merged')
    expect(await buildRuns(p.blocked)).toBe(1)
    expect(await f.view(p.blocked)).toMatchObject({ stage: 'build', waitingOn: 'agents' })
    expect(fold(await readEvents(f.h.payload(), p.blocked)).blockedReason).toBeNull()
  })

  it.each([
    ['discarded', 'discarded', 'was discarded'],
    ['closed on the forge', 'closed-on-forge', 'was closed without a merge'],
  ] as const)('stays blocked with the reason when the blocker is %s', async (_name, reason, words) => {
    const p = await blockedPair()
    const closed = { type: 'ticket.closed', data: { reason }, actor: 'factory' } as const
    await appendEvent(f.h.payload(), p.blocker, closed)
    await advance(p.blocked, f.subDeps())
    expect(await f.view(p.blocked)).toMatchObject({ stage: 'build', waitingOn: 'nobody', card: null })
    expect(await f.types(p.blocked)).not.toContain('question.asked')
    expect(await buildRuns(p.blocked)).toBe(0)
    const stored = fold(await readEvents(f.h.payload(), p.blocked)).blockedReason
    expect(stored).toContain('#2')
    expect(stored).toContain(words)
  })
})
