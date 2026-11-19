import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { advance, MAX_ADVANCE_STEPS } from '../../src/core/engine'
import { defineModule } from '../../src/core/module'
import { patchRecord, readRecord } from '../../src/core/record/store'
import { RunNotClaimed, WrongLeaseToken } from '../../src/core/run/errors'
import { claim } from '../../src/core/run/leases'
import { readRun } from '../../src/core/run/store'
import { expireRuns, releaseRun, submit } from '../../src/core/submit'
import { openEngine, TEST_MODULES, type Engine } from './harness'

let e: Engine
beforeAll(async () => {
  e = await openEngine('core_engine')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  e.config = { ...e.config, caps: { verifyRounds: 2, reporterRounds: 2, failedRuns: 2 }, productionGate: false }
  e.merges.length = 0
  await e.drain()
})

const started = async () => {
  const id = await e.db.fresh()
  await advance(id, e.deps())
  return id
}
const atBuild = async () => {
  const id = await started()
  await e.work(id, 'builder', { verdict: 'accept' })
  await e.work(id, 'builder', { goal: 'Fix it', open: false })
  return id
}
const atVerify = async () => {
  const id = await atBuild()
  await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
  await e.checks(id)
  return id
}
const count = (types: string[], type: string) => types.filter((t) => t === type).length

describe('advance', () => {
  it('queues the intake run once and waits on agents', async () => {
    const id = await started()
    await advance(id, e.deps())
    const view = await e.view(id)
    expect(view).toMatchObject({ stage: 'intake', waitingOn: 'agents', card: null })
    expect(count(view.types, 'run.started')).toBe(1)
  })

  it('stops at a Brief card when the brief has an open decision', async () => {
    const id = await started()
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: true })
    const view = await e.view(id)
    expect(view).toMatchObject({ stage: 'brief', waitingOn: 'owner' })
    expect(view.card).toEqual({ card: 'brief', reason: 'open-decision', options: [] })
  })

  it('waits on agents for the checks, then queues the verify run', async () => {
    const id = await atBuild()
    await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
    expect(await e.view(id)).toMatchObject({ stage: 'verify', waitingOn: 'agents', card: null })
    await e.checks(id)
    const view = await e.view(id)
    expect(count(view.types, 'run.started')).toBe(4)
  })

  it('merges through the injected merge and records the commit', async () => {
    const id = await atVerify()
    await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
    const view = await e.view(id)
    expect(e.merges).toEqual([1])
    expect(view.types.slice(-2)).toEqual(['verify.passed', 'ship.merged'])
    expect(view).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    expect(view.card).toEqual({ card: 'result', reason: 'result', options: [] })
  })

  it('records a failed merge as a failed ship run and tries again', async () => {
    const id = await atVerify()
    let calls = 0
    e.mergeWith.fn = (target) =>
      ++calls === 1 ? Promise.reject(new Error('conflict')) : Promise.resolve({ sha: `s${target.pr}` })
    await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
    const types = (await e.view(id)).types
    expect(types.slice(-3)).toEqual(['verify.passed', 'run.failed', 'ship.merged'])
    e.mergeWith.fn = (target) => Promise.resolve({ sha: `sha-${target.pr}` })
  })

  it('asks the failed-runs question once when merges keep failing', async () => {
    const id = await atVerify()
    e.mergeWith.fn = () => Promise.reject(new Error('conflict'))
    await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
    await advance(id, e.deps())
    const view = await e.view(id)
    expect(count(view.types, 'question.asked')).toBe(1)
    expect(count(view.types, 'run.failed')).toBe(2)
    expect(view).toMatchObject({ waitingOn: 'owner' })
    expect(view.card).toMatchObject({ card: 'question', reason: 'failed-runs' })
    e.mergeWith.fn = (target) => Promise.resolve({ sha: `sha-${target.pr}` })
  })

  it('always terminates, even when every step repeats', async () => {
    e.config = { ...e.config, caps: { verifyRounds: 2, reporterRounds: 2, failedRuns: 99 } }
    const id = await atVerify()
    let calls = 0
    e.mergeWith.fn = () => Promise.reject(new Error(`attempt ${++calls}`))
    await e.work(id, 'verifier', { passed: true, patchId: 'p1', headSha: 'h1' })
    expect(calls).toBe(MAX_ADVANCE_STEPS)
    e.mergeWith.fn = (target) => Promise.resolve({ sha: `sha-${target.pr}` })
  })

  it('projects done with nobody waiting and no card for a closed ticket', async () => {
    const id = await started()
    await e.work(id, 'builder', { verdict: 'accept' })
    await e.work(id, 'builder', { goal: 'Fix it', open: true })
    const { appendEvent } = await import('../../src/core/record/store')
    await appendEvent(e.db.payload, id, { type: 'brief.discarded', data: {}, actor: 'owner', actorId: '1' })
    await advance(id, e.deps())
    expect(await e.view(id)).toMatchObject({ waitingOn: 'nobody', card: null })
  })
})

const claimed = async (id: number) => {
  const got = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 'x', now: e.clock.now })
  expect(got?.run.recordId).toBe(id)
  if (!got) throw new Error('no run')
  return got
}
const snapshot = async (id: number) => JSON.stringify((await readRecord(e.db.payload, id)).record)

describe('submit', () => {
  it('refuses a wrong token and changes nothing', async () => {
    const id = await started()
    const { run } = await claimed(id)
    const before = await snapshot(id)
    await expect(submit(run.id, 'wrong', { verdict: 'accept' }, e.deps())).rejects.toThrow(WrongLeaseToken)
    expect((await readRun(e.db.payload, run.id)).status).toBe('claimed')
    expect(await snapshot(id)).toBe(before)
    expect(count((await e.view(id)).types, 'intake.accepted')).toBe(0)
  })

  it('refuses a run that is not claimed, including a second submit', async () => {
    const id = await started()
    const { run, token } = await claimed(id)
    expect(await submit(run.id, token, { verdict: 'accept' }, e.deps())).toEqual({ status: 'accepted' })
    await expect(submit(run.id, token, { verdict: 'accept' }, e.deps())).rejects.toThrow(RunNotClaimed)
    expect(count((await e.view(id)).types, 'intake.accepted')).toBe(1)
    expect(await readRun(e.db.payload, run.id)).toMatchObject({ status: 'submitted', result: { verdict: 'accept' } })
  })

  it('gives one fix turn for an invalid result, then fails the run', async () => {
    const id = await started()
    const { run, token } = await claimed(id)
    const first = await submit(run.id, token, { verdict: 'maybe' }, e.deps())
    expect(first).toMatchObject({ status: 'retry', problems: [{ path: 'verdict' }] })
    expect(await readRun(e.db.payload, run.id)).toMatchObject({ status: 'claimed', attempt: 1 })
    const second = await submit(run.id, token, {}, e.deps())
    expect(second.status).toBe('failed')
    expect(await readRun(e.db.payload, run.id)).toMatchObject({ status: 'failed', attempt: 1 })
    const view = await e.view(id)
    expect(count(view.types, 'run.failed')).toBe(1)
    expect(count(view.types, 'run.started')).toBe(2)
  })

  it('accepts a valid result on the fix turn', async () => {
    const id = await started()
    const { run, token } = await claimed(id)
    await submit(run.id, token, { verdict: 'maybe' }, e.deps())
    expect(await submit(run.id, token, { verdict: 'accept' }, e.deps())).toEqual({ status: 'accepted' })
    expect((await e.view(id)).stage).toBe('brief')
  })

  it('refuses a result that would change a field outside the module writes', async () => {
    const hijack = defineModule({
      stage: 'intake',
      role: 'builder',
      writes: ['handoff'],
      resultSchema: z.object({ ok: z.boolean() }),
      apply: () => ({ patch: { goal: 'hijacked' }, events: [{ type: 'intake.accepted', data: {} }] }),
    })
    const modules = { ...TEST_MODULES, intake: hijack }
    const id = await started()
    const { run, token } = await claimed(id)
    const first = await submit(run.id, token, { ok: true }, { ...e.deps(), modules })
    expect(first).toMatchObject({ status: 'retry', problems: [{ path: '' }] })
    expect((await readRecord(e.db.payload, id)).record.goal).toBe('')
    const second = await submit(run.id, token, { ok: true }, { ...e.deps(), modules })
    expect(second.status).toBe('failed')
    expect((await readRecord(e.db.payload, id)).record.goal).toBe('')
    expect(count((await e.view(id)).types, 'intake.accepted')).toBe(0)
  })

  it('retries once from a fresh read when the record changed under it', async () => {
    const id = await started()
    const { run, token } = await claimed(id)
    let applied = 0
    const racing = defineModule({
      stage: 'intake',
      role: 'builder',
      writes: ['handoff'],
      resultSchema: z.object({ ok: z.boolean() }),
      apply: () => {
        applied++
        return { patch: { handoff: 'done' }, events: [{ type: 'intake.accepted', data: {} }] }
      },
    })
    const other = await e.db.payload.db.pool.connect()
    await other.query('BEGIN')
    await other.query('UPDATE "records" SET "version" = "version" + 1 WHERE "id" = $1', [id])
    const pending = submit(run.id, token, { ok: true }, { ...e.deps(), modules: { intake: racing } })
    const blocked = sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'`
    while (Number((await e.db.payload.db.drizzle.execute(blocked)).rows[0]?.n) === 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
    }
    await other.query('COMMIT')
    other.release()
    const result = await pending
    expect(result).toEqual({ status: 'accepted' })
    expect(applied).toBe(2)
    expect((await readRecord(e.db.payload, id)).record.handoff).toBe('done')
  })

  it('lets a patch through when the field is in writes', async () => {
    const id = await atBuild()
    const stored = await readRecord(e.db.payload, id)
    await patchRecord(e.db.payload, id, {
      expectedVersion: stored.version,
      writes: ['handoff'],
      patch: { handoff: 'x' },
      by: { stage: 'build', runId: 'r' },
    })
    await e.work(id, 'builder', { patchId: 'p1', headSha: 'h1', pr: 1 })
    expect((await readRecord(e.db.payload, id)).record.handoff).toBe('built p1')
  })
})

describe('releaseRun and expireRuns', () => {
  it('releases a run, appends run.released and queues a new run', async () => {
    const id = await started()
    const { run, token } = await claimed(id)
    await expect(releaseRun(run.id, 'wrong', e.deps())).rejects.toThrow(WrongLeaseToken)
    await releaseRun(run.id, token, e.deps())
    const view = await e.view(id)
    expect(view.types.slice(-2)).toEqual(['run.released', 'run.started'])
    expect((await readRun(e.db.payload, run.id)).status).toBe('released')
  })

  it('expires only runs whose lease has passed', async () => {
    const id = await started()
    const { run } = await claimed(id)
    expect(await expireRuns(e.deps())).toEqual([])
    const later = { ...e.deps(), now: new Date(e.clock.now.getTime() + 31 * 60_000) }
    expect(await expireRuns(later)).toEqual([{ runId: run.id, recordId: id, stage: 'intake' }])
    expect((await e.view(id)).types.slice(-2)).toEqual(['run.released', 'run.started'])
  })
})
