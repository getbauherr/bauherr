import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setRank } from '../../src/core/record/store'
import { RunConflict, RunNotClaimed, WrongLeaseToken } from '../../src/core/run/errors'
import { z } from 'zod'
import { claim, enqueue, expire, heartbeat, LEASE_MS, release, type Claimed } from '../../src/core/run/leases'
import { readRun } from '../../src/core/run/store'
import { openCoreDb, type CoreDb } from './db'

let db: CoreDb
const t0 = new Date('2026-11-19T10:00:00Z')
const later = (ms: number) => new Date(t0.getTime() + ms)

beforeAll(async () => {
  db = await openCoreDb('core_leases')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

const build = { stage: 'build', role: 'builder', fingerprint: 'fp1' } as const
const queued = async (workspace = db.workspace) => {
  const record = await db.fresh(workspace)
  const { run } = await enqueue(db.payload, record, build)
  return { record, run }
}
const claimBuilder = (workspace = db.workspace, now = t0) =>
  claim(db.payload, { workspace, role: 'builder', by: 'agent-1', now })
const drain = async () => {
  const live = sql`UPDATE "stage_runs" SET "status" = 'released' WHERE "status" IN ('queued', 'claimed')`
  await db.payload.db.drizzle.execute(live)
}

beforeEach(drain)

describe('enqueue', () => {
  it('creates a queued run and returns the same one for the same stage and fingerprint', async () => {
    const record = await db.fresh()
    const first = await enqueue(db.payload, record, build)
    const second = await enqueue(db.payload, record, build)
    expect(first.created).toBe(true)
    expect(second).toEqual({ run: first.run, created: false })
    expect(first.run).toMatchObject({ status: 'queued', attempt: 0, steps: [], stage: 'build', role: 'builder' })
  })

  it('refuses a second live run for the same record with another fingerprint', async () => {
    const record = await db.fresh()
    await enqueue(db.payload, record, build)
    await expect(enqueue(db.payload, record, { ...build, fingerprint: 'fp2' })).rejects.toThrow(RunConflict)
  })

  it('allows a new run once the earlier one is released', async () => {
    const { record, run } = await queued()
    const claimed = await claimBuilder()
    expect(claimed?.run.id).toBe(run.id)
    await release(db.payload, run.id, claimed?.token ?? '', t0)
    const again = await enqueue(db.payload, record, { ...build, fingerprint: 'fp2' })
    expect(again.created).toBe(true)
  })
})

describe('claim', () => {
  it('returns null when nothing is queued for the role or Workspace', async () => {
    await queued(db.otherWorkspace)
    expect(await claimBuilder()).toBeNull()
    expect(await claim(db.payload, { workspace: db.workspace, role: 'verifier', by: 'a', now: t0 })).toBeNull()
  })

  it('takes the run of the lowest rank first, then the oldest', async () => {
    const a = await queued()
    const b = await queued()
    const c = await queued()
    await setRank(db.payload, c.record, -1)
    const order = [await claimBuilder(), await claimBuilder(), await claimBuilder(), await claimBuilder()]
    expect(order.map((x) => x?.run.id ?? null)).toEqual([c.run.id, a.run.id, b.run.id, null])
  })

  it('sets the lease and stores only the hash of the token', async () => {
    const { run } = await queued()
    const claimed = await claimBuilder()
    expect(claimed?.run).toMatchObject({ id: run.id, status: 'claimed', leasedBy: 'agent-1' })
    expect(claimed?.run.leaseExpiresAt).toEqual(later(LEASE_MS))
    const stored = await db.payload.db.drizzle.execute(
      sql`SELECT "lease_token_hash" AS h FROM "stage_runs" WHERE "id" = ${run.id}`,
    )
    expect(stored.rows[0]?.h).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.rows[0]?.h).not.toBe(claimed?.token)
  })

  it('never hands the same run to concurrent claims', async () => {
    const runs = await Promise.all(Array.from({ length: 6 }, () => queued()))
    const results = await Promise.all(Array.from({ length: 12 }, () => claimBuilder()))
    const got = results.flatMap((r) => (r ? [r.run.id] : []))
    expect(got.length).toBe(6)
    expect(new Set(got).size).toBe(6)
    expect([...got].sort()).toEqual(runs.map((r) => r.run.id).sort())
  })
})

describe('heartbeat and release', () => {
  it('extends the lease and appends the step', async () => {
    const { run } = await queued()
    const claimed = await claimBuilder()
    const beat = await heartbeat(db.payload, run.id, claimed?.token ?? '', { now: later(60_000), step: 'reading' })
    expect(beat.leaseExpiresAt).toEqual(later(60_000 + LEASE_MS))
    expect(beat.steps).toEqual([{ at: later(60_000).toISOString(), text: 'reading' }])
    const plain = await heartbeat(db.payload, run.id, claimed?.token ?? '', { now: later(120_000) })
    expect(plain.steps).toHaveLength(1)
  })

  it('keeps the newest 50 steps', async () => {
    const { run } = await queued()
    const claimed = await claimBuilder()
    for (let i = 1; i <= 52; i++) {
      await heartbeat(db.payload, run.id, claimed?.token ?? '', { now: later(i), step: `s${i}` })
    }
    const steps = (await readRun(db.payload, run.id)).steps
    expect(steps).toHaveLength(50)
    expect(steps[0]?.text).toBe('s3')
    expect(steps[49]?.text).toBe('s52')
  })

  it('refuses a wrong token with a distinct error and leaves the run alone', async () => {
    const { run } = await queued()
    const claimed = await claimBuilder()
    await expect(heartbeat(db.payload, run.id, 'nope', { now: t0, step: 'x' })).rejects.toThrow(WrongLeaseToken)
    await expect(release(db.payload, run.id, 'nope', t0)).rejects.toThrow(WrongLeaseToken)
    const after = await readRun(db.payload, run.id)
    expect(after).toMatchObject({ status: 'claimed', steps: [] })
    expect(after.leaseExpiresAt).toEqual(claimed?.run.leaseExpiresAt)
  })

  it('refuses a run that is not claimed', async () => {
    const { run } = await queued()
    await expect(heartbeat(db.payload, run.id, 'x', { now: t0 })).rejects.toThrow(RunNotClaimed)
    const claimed = await claimBuilder()
    const released = await release(db.payload, run.id, claimed?.token ?? '', t0)
    expect(released.status).toBe('released')
    await expect(heartbeat(db.payload, run.id, claimed?.token ?? '', { now: t0 })).rejects.toThrow(RunNotClaimed)
    await expect(release(db.payload, run.id, claimed?.token ?? '', t0)).rejects.toThrow(RunNotClaimed)
  })
})

describe('expire', () => {
  it('releases only claimed runs whose lease has passed', async () => {
    const a = await queued()
    const b = await queued()
    const c = await queued()
    const first = await claimBuilder()
    await claimBuilder(db.workspace, later(20 * 60_000))
    expect(first?.run.id).toBe(a.run.id)
    expect(await expire(db.payload, later(LEASE_MS - 1))).toEqual([])
    const expired = await expire(db.payload, later(LEASE_MS + 1))
    expect(expired).toEqual([{ runId: a.run.id, recordId: a.record, stage: 'build' }])
    const gone = await readRun(db.payload, a.run.id)
    expect(gone.status).toBe('expired')
    expect(gone.error).toBe('no heartbeat for 30 minutes')
    expect((await readRun(db.payload, b.run.id)).status).toBe('claimed')
    expect((await readRun(db.payload, c.run.id)).status).toBe('queued')
  })
})

describe('claim by executor', () => {
  const setExecutor = (executor: string) =>
    db.payload.db.drizzle.execute(sql`UPDATE "products" SET "executor" = ${executor} WHERE "id" = ${db.product}`)
  const claimFor = (executor: 'session' | 'runner') =>
    claim(db.payload, { workspace: db.workspace, role: 'builder', by: 'x', now: t0, executor })

  it('leaves a run of a session Product to sessions and never to the runner', async () => {
    await setExecutor('session')
    const { run } = await queued()
    expect(await claimFor('runner')).toBeNull()
    expect((await claimFor('session'))?.run.id).toBe(run.id)
  })

  it('leaves a run of a runner Product to the runner and never to sessions', async () => {
    await setExecutor('runner')
    const { run } = await queued()
    expect(await claimFor('session')).toBeNull()
    expect((await claimFor('runner'))?.run.id).toBe(run.id)
    await setExecutor('session')
  })
})

describe('a session with several runs', () => {
  it('expires only the run that stopped heartbeating', async () => {
    const claimed: Claimed[] = []
    for (let i = 0; i < 3; i++) {
      await queued()
      claimed.push(z.custom<Claimed>().parse(await claimBuilder()))
    }
    const [first, second, silent] = claimed.map((c) => ({ id: c.run.id, token: c.token }))
    const beat = { now: later(LEASE_MS - 60_000) }
    await heartbeat(db.payload, z.number().parse(first?.id), z.string().parse(first?.token), beat)
    await heartbeat(db.payload, z.number().parse(second?.id), z.string().parse(second?.token), beat)
    const expired = await expire(db.payload, later(LEASE_MS + 1000))
    expect(expired.map((e) => e.runId)).toEqual([silent?.id])
    const statuses = await Promise.all([first, second, silent].map((r) => readRun(db.payload, z.number().parse(r?.id))))
    expect(statuses.map((r) => r.status)).toEqual(['claimed', 'claimed', 'expired'])
  })
})

describe('a run left over from the removed Learn step', () => {
  it('is never claimed, even when its ticket is done', async () => {
    const record = await db.fresh()
    await enqueue(db.payload, record, { stage: 'done', role: 'reviewer', fingerprint: 'old' })
    await db.payload.db.drizzle.execute(sql`UPDATE "records" SET "stage" = 'done' WHERE "id" = ${record}`)
    expect(await claim(db.payload, { workspace: db.workspace, role: 'reviewer', by: 'a', now: t0 })).toBeNull()
  })
})
