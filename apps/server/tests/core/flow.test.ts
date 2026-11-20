import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decide, type Decision, StaleDecision } from '../../src/core/decide'
import { advance } from '../../src/core/engine'
import { fingerprint } from '../../src/core/lifecycle'
import { readRecord } from '../../src/core/record/store'
import { claim, LEASE_MS } from '../../src/core/run/leases'
import { expireRuns, submit } from '../../src/core/submit'
import { openEngine, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_flow')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  e.config = { ...e.config, caps: { verifyRounds: 3, reporterRounds: 2, failedRuns: 2 }, productionGate: false }
  e.merges.length = 0
  await e.drain()
})

const answer = async (id: number, d: Omit<Decision, 'seq'>) =>
  decide(id, e.owner, { ...d, seq: await e.seq(id) }, e.deps())
const begin = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  return id
}
const expectView = async (id: number, stage: string, waitingOn: string, card: unknown = null) => {
  expect(await e.view(id)).toMatchObject({ stage, waitingOn, card })
}
const resultCard = { card: 'result', reason: 'result', options: [] }
const toBrief = async (open: boolean) => {
  const id = await begin()
  await expectView(id, 'intake', 'agents')
  await e.work(id, 'builder', { verdict: 'accept' })
  await expectView(id, 'brief', 'agents')
  await e.work(id, 'builder', { goal: 'Fix it', open })
  return id
}
const patch = async (id: number, n: number) => {
  await e.work(id, 'builder', { patchId: `p${n}`, headSha: `h${n}`, pr: n })
  await e.checks(id)
}
const toResult = async () => {
  const id = await toBrief(false)
  await patch(id, 1)
  await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
  return id
}
const runRows = async (id: number) =>
  (await e.db.payload.db.drizzle.execute(sql`SELECT "id", "status", "fingerprint", "stage" FROM "stage_runs"
    WHERE "record_id" = ${id} ORDER BY "id"`)).rows

describe('a ticket from intake to done', () => {
  it('runs the happy path without a gate and stops where it should', async () => {
    const id = await begin()
    await expectView(id, 'intake', 'agents')
    await e.work(id, 'builder', { verdict: 'accept' })
    await expectView(id, 'brief', 'agents')
    await e.work(id, 'builder', { goal: 'Fix it', open: false })
    await expectView(id, 'build', 'agents')
    await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 12 })
    await expectView(id, 'verify', 'agents')
    await e.checks(id)
    await expectView(id, 'verify', 'agents')
    await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
    await expectView(id, 'ship', 'owner', resultCard)
    expect(e.merges).toEqual([12])
    await answer(id, { ask: 'result', choice: 'accept' })
    await expectView(id, 'done', 'nobody')
    expect((await e.view(id)).types).toEqual([
      'run.started', 'intake.accepted', 'run.started', 'brief.submitted', 'brief.approved', 'run.started',
      'build.submitted', 'checks.finished', 'run.started', 'verify.passed', 'ship.merged', 'result.accepted',
    ])
    expect((await runRows(id)).map((r) => r.status)).toEqual(['submitted', 'submitted', 'submitted', 'submitted'])
  })

  it('stops at a Brief card for an open decision until the owner approves', async () => {
    const id = await toBrief(true)
    await expectView(id, 'brief', 'owner', { card: 'brief', reason: 'open-decision', options: [] })
    await answer(id, { ask: 'brief', choice: 'approve', answers: { d1: 'a' } })
    await expectView(id, 'build', 'agents')
  })

  it('asks the verify-rounds question after three send-backs and allows exactly one more build', async () => {
    const id = await toBrief(false)
    await patch(id, 1)
    for (const n of [1, 2]) {
      await e.work(id, 'verifier', { passed: false, patchId: `p${n}`, headSha: `h${n}` })
      await expectView(id, 'build', 'agents')
      await patch(id, n + 1)
    }
    await e.work(id, 'verifier', { passed: false, patchId: 'p3', headSha: 'h3' })
    const ask = { card: 'question', reason: 'verify-rounds', options: ['one-more-round', 'accept-as-is', 'discard'] }
    await expectView(id, 'build', 'owner', ask)
    await answer(id, { ask: 'question:verify-rounds', choice: 'one-more-round' })
    await expectView(id, 'build', 'agents')
    await patch(id, 4)
    await e.work(id, 'verifier', { passed: false, patchId: 'p4', headSha: 'h4' })
    await expectView(id, 'build', 'owner', ask)
    const types = (await e.view(id)).types
    expect(types.filter((t) => t === 'build.submitted')).toHaveLength(4)
  })

  it('fails a run after two invalid results, asks failed-runs after two failed runs, and keys guidance', async () => {
    const id = await begin()
    const invalid = async (): Promise<void> => {
      const input = { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now } as const
      const claimed = await claim(e.db.payload, input)
      if (!claimed) throw new Error('no run queued')
      const first = await submit(claimed.run.id, claimed.token, { verdict: 'maybe' }, e.deps())
      const second = await submit(claimed.run.id, claimed.token, {}, e.deps())
      expect([first.status, second.status]).toEqual(['retry', 'failed'])
    }
    await invalid()
    await expectView(id, 'intake', 'agents')
    await invalid()
    const ask = { card: 'question', reason: 'failed-runs', options: ['retry', 'retry-with-guidance', 'discard'] }
    await expectView(id, 'intake', 'owner', ask)
    const before = (await runRows(id)).map((r) => String(r.fingerprint))
    const guidance = { ask: 'question:failed-runs', choice: 'retry-with-guidance', note: 'use the API' }
    await answer(id, guidance)
    await expectView(id, 'intake', 'agents')
    const rows = await runRows(id)
    const last = rows[rows.length - 1]
    expect(last?.status).toBe('queued')
    expect(before).not.toContain(String(last?.fingerprint))
    const stored = await readRecord(e.db.payload, id)
    expect(last?.fingerprint).toBe(fingerprint({ stage: 'intake', version: stored.version, note: 'use the API' }))
    expect((await e.view(id)).types.filter((t) => t === 'run.failed')).toHaveLength(2)
  })

  it('releases a run whose lease expired and queues a new one', async () => {
    const id = await begin()
    const first = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
    const later = { ...e.deps(), now: new Date(e.clock.now.getTime() + LEASE_MS + 1) }
    expect(await expireRuns(later)).toHaveLength(1)
    const rows = await runRows(id)
    expect(rows.map((r) => r.status)).toEqual(['released', 'queued'])
    expect((await e.view(id)).types).toEqual(['run.started', 'run.released', 'run.started'])
    await expectView(id, 'intake', 'agents')
    const again = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'y', now: e.clock.now })
    expect(again?.run.id).not.toBe(first?.run.id)
  })

  it('refuses to approve a Brief while the Result card is open', async () => {
    const id = await toResult()
    await expectView(id, 'ship', 'owner', resultCard)
    await expect(answer(id, { ask: 'brief', choice: 'approve' })).rejects.toThrow(StaleDecision)
    await expectView(id, 'ship', 'owner', resultCard)
  })

  it('holds production after acceptance until the owner approves it', async () => {
    e.config = { ...e.config, productionGate: true }
    const id = await toResult()
    await answer(id, { ask: 'result', choice: 'accept' })
    const ask = { card: 'question', reason: 'production', options: ['approve', 'hold'] }
    await expectView(id, 'ship', 'owner', ask)
    await answer(id, { ask: 'question:production', choice: 'hold' })
    const held = { card: 'question', reason: 'production-held', options: ['approve-production'], seq: 15 }
    await expectView(id, 'ship', 'owner', held)
    await expect(answer(id, { ask: 'question:production', choice: 'approve' })).rejects.toThrow(
      StaleDecision,
    )
    await answer(id, { ask: 'production-held', choice: 'approve-production' })
    await expectView(id, 'done', 'nobody')
    expect((await e.view(id)).types.slice(-5)).toEqual([
      'result.accepted', 'question.asked', 'question.answered', 'production.held', 'production.approved',
    ])
  })
})
