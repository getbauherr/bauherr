import { FakeBackend, type Forge } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { advance } from '../../src/core/engine'
import { fold, foldOptions } from '../../src/core/lifecycle'
import type { AppEvent } from '../../src/core/events'
import { appendEvent, createRecord, readEvents } from '../../src/core/record/store'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, reacting, product } = intakeHarness('core_mirror_conflicts')

const counted = (fake: FakeBackend) => {
  const calls: Record<string, number> = {}
  const forge = new Proxy(fake.forge, {
    get: (target, name: keyof Forge) => {
      const value: unknown = Reflect.get(target, name)
      if (typeof value !== 'function') return value
      return (...args: unknown[]): unknown => {
        calls[name] = (calls[name] ?? 0) + 1
        return Reflect.apply(value, target, args)
      }
    },
  })
  return { calls, reader: { ...readerOf(fake), forge } }
}

const setup = async (reviewed = true) => {
  await product(sql`"required_checks" = 'ci'`)
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'broken' })
  await fake.forge.createBranch(repo, 'fix')
  const headSha = fake.commit(repo, 'fix', 'a.txt', 'x')
  const pull = await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main' })
  const { calls, reader } = counted(fake)
  const readers = { [repo]: reader }
  await h.settle(readers)
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const append = (event: AppEvent) => appendEvent(h.payload(), record.id, { ...event, actor: 'factory' })
  const built: AppEvent[] = [
    { type: 'intake.accepted', data: {} },
    { type: 'brief.submitted', data: { runId: '1' } },
    { type: 'brief.approved', data: { by: 'rule' } },
    { type: 'build.submitted', data: { runId: '2', patchId: 'p1', headSha, pr: pull.number } },
  ]
  for (const event of built) await append(event)
  if (reviewed) {
    await append({ type: 'review.submitted', data: { runId: '9', patchId: 'p1', headSha, findings: 0 } })
  }
  await advance(record.id, deps())
  const types = async () => (await readEvents(h.payload(), record.id)).map((e) => e.type)
  const state = async () => {
    const options = foldOptions(await deps().configFor(record.id))
    return fold(await readEvents(h.payload(), record.id), options)
  }
  const stage = async () => (await h.rows(sql`SELECT "stage" FROM "records" WHERE "id" = ${record.id}`))[0]?.stage
  const runs = () =>
    h.rows(sql`SELECT "stage", "role", "status" FROM "stage_runs" WHERE "record_id" = ${record.id} ORDER BY "id"`)
  const sync = () => h.sync(readers, reacting)
  return { repo, fake, headSha, pull, record, append, types, state, stage, runs, sync, calls }
}

type Setup = Awaited<ReturnType<typeof setup>>

const conflicting = (s: Setup, value: boolean | undefined) => s.fake.setMergeable(s.repo, s.pull.number, value)
const reads = (s: Setup) => s.calls.getPullRequest ?? 0

describe('a conflicting pull request of a ticket that waits for checks', () => {
  it('gets pull.conflicted on the next sync, once, and the ticket returns to Build', async () => {
    const s = await setup()
    conflicting(s, false)
    await s.sync()
    expect(await s.types()).toContain('pull.conflicted')
    expect((await s.state()).conflict).toEqual({ patchId: 'p1', base: 'main' })
    expect(await s.stage()).toBe('build')
    await s.sync()
    await s.sync()
    expect((await s.types()).filter((t) => t === 'pull.conflicted')).toHaveLength(1)
    expect(await s.runs()).toEqual([{ stage: 'build', role: 'builder', status: 'queued' }])
  })

  it('does nothing for a pull request that merges cleanly', async () => {
    const s = await setup()
    conflicting(s, true)
    await s.sync()
    expect(await s.types()).not.toContain('pull.conflicted')
    expect(await s.stage()).toBe('verify')
  })
})

describe('what a conflict returns from, and what it counts', () => {
  it('ends a live review run and does not count a verify round', async () => {
    const s = await setup(false)
    expect(await s.runs()).toEqual([{ stage: 'verify', role: 'reviewer', status: 'queued' }])
    conflicting(s, false)
    await s.sync()
    expect(await s.runs()).toEqual([
      { stage: 'verify', role: 'reviewer', status: 'released' },
      { stage: 'build', role: 'builder', status: 'queued' },
    ])
    expect(await s.types()).toContain('run.released')
    expect((await s.state()).verifyRounds).toBe(0)
  })

  it('ends a live verifier run', async () => {
    const s = await setup()
    conflicting(s, true)
    s.fake.setChecks(s.repo, s.headSha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
    await s.sync()
    expect(await s.runs()).toEqual([{ stage: 'verify', role: 'verifier', status: 'queued' }])
    s.fake.commit(s.repo, 'main', 'm.txt', 'moved')
    conflicting(s, false)
    await s.sync()
    expect(await s.runs()).toEqual([
      { stage: 'verify', role: 'verifier', status: 'released' },
      { stage: 'build', role: 'builder', status: 'queued' },
    ])
    expect((await s.state()).verifyRounds).toBe(0)
  })

  it('returns a ticket that waits to merge in Ship, before any merge is tried', async () => {
    const s = await setup()
    await s.append({ type: 'checks.finished', data: { patchId: 'p1', passed: true } })
    await s.append({ type: 'verify.passed', data: { runId: '10', patchId: 'p1', headSha: s.headSha } })
    await h.rows(sql`UPDATE "records" SET "stage" = 'ship', "waiting_on" = 'owner' WHERE "id" = ${s.record.id}`)
    conflicting(s, false)
    await s.sync()
    expect(await s.types()).toContain('pull.conflicted')
    expect(await s.types()).not.toContain('ship.merged')
    expect(await s.stage()).toBe('build')
  })
})

describe('the forge calls of the conflict check', () => {
  it('reads once while nothing moves, again after the head or the base moved, and while unknown', async () => {
    const s = await setup()
    conflicting(s, true)
    await s.sync()
    expect(reads(s)).toBe(1)
    await s.sync()
    await s.sync()
    expect(reads(s)).toBe(1)

    s.fake.commit(s.repo, 'fix', 'b.txt', 'y')
    await s.fake.forge.getPullRequest(s.repo, s.pull.number)
    conflicting(s, true)
    await s.sync()
    expect(reads(s)).toBe(2)
    await s.sync()
    expect(reads(s)).toBe(2)

    s.fake.commit(s.repo, 'main', 'c.txt', 'z')
    await s.sync()
    expect(reads(s)).toBe(3)
    await s.sync()
    expect(reads(s)).toBe(3)

    conflicting(s, undefined)
    s.fake.commit(s.repo, 'main', 'd.txt', 'z')
    await s.sync()
    await s.sync()
    await s.sync()
    expect(reads(s)).toBe(6)
  })

  it('reads no pull request of a ticket that is not in Verify or Ship, and none of an unrelated one', async () => {
    const s = await setup()
    await h.rows(sql`UPDATE "records" SET "stage" = 'build' WHERE "id" = ${s.record.id}`)
    await s.fake.forge.createBranch(s.repo, 'other')
    s.fake.commit(s.repo, 'other', 'o.txt', 'o')
    await s.fake.forge.openPullRequest(s.repo, { title: 'o', head: 'other', base: 'main' })
    await s.sync()
    await s.sync()
    expect(reads(s)).toBe(0)
  })
})
