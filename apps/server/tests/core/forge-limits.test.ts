import { FakeBackend, ForgeRateLimited, GithubError, Http, patAuth } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advance } from '../../src/core/engine'
import { activeHolds, holdOf, readLimits, saveBudget } from '../../src/core/forge/limits'
import { createWriter } from '../../src/core/forge/writer'
import { CAPS } from '../../src/core/caps'
import { appendEvent, createRecord, readEvents, readRecord, type NewEvent } from '../../src/core/record/store'
import { mergeVia } from '../../src/jobs/engine-deps'
import { mirrorHarness, readerOf, START } from './mirror-harness'

const h = mirrorHarness('core_forge_limits')

const MIN = 60_000
const limitedUntil = (at: Date) =>
  new ForgeRateLimited('GitHub', 403, 'GET', '/x', at.getTime() - START.getTime(), START.getTime())

const setLimits = (value: object) =>
  h.rows(
    sql`UPDATE "connections" SET "forge_limits" = ${JSON.stringify(value)}::jsonb WHERE "id" = ${h.ids.connection}`,
  )

beforeEach(async () => {
  await h.rows(sql`UPDATE "connections" SET "forge_limits" = NULL`)
})

describe('the poller when the rate limit is used up', () => {
  it('pauses without a failure until the reset time, then resumes', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.tickets(repo).create({ title: 'one' })
    const resetAt = new Date(START.getTime() + 10 * MIN)
    const reader = readerOf(fake)
    let calls = 0
    const limited = {
      forge: reader.forge,
      tickets: () => ({
        ...reader.tickets(repo),
        poll: async () => {
          calls++
          throw limitedUntil(resetAt)
        },
      }),
    }
    const sourceId = await h.newSource(repo)

    expect(await h.sync({ [repo]: limited })).toEqual({ synced: 0, failed: 0, paused: 1 })
    expect((await h.source(sourceId))?.last_error ?? null).toBeNull()
    expect((await activeHolds(h.payload(), h.ids.workspace, START)).map((hold) => hold.message)).toEqual([
      'GitHub limit reached, resumes at 10:10 UTC',
    ])
    expect((await holdOf(h.payload(), h.ids.connection, START))?.message).toBe(
      'GitHub limit reached, resumes at 10:10 UTC',
    )

    h.later(5 * MIN)
    expect(await h.sync({ [repo]: limited })).toEqual({ synced: 0, failed: 0, paused: 1 })
    expect(calls).toBe(1)

    h.later(6 * MIN)
    expect(await h.sync({ [repo]: readerOf(fake) })).toEqual({ synced: 1, failed: 0, paused: 0 })
    expect(await h.numbersOf(repo)).toEqual([1])
  })

  it('counts a 5xx outage as a failed poll but holds forge work for two minutes', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const reader = readerOf(fake)
    const down = {
      forge: reader.forge,
      tickets: () => ({
        ...reader.tickets(repo),
        poll: async () => {
          throw new GithubError(502, 'GET', '/issues', 'Bad Gateway')
        },
      }),
    }
    expect(await h.sync({ [repo]: down })).toEqual({ synced: 0, failed: 1, paused: 0 })
    expect((await holdOf(h.payload(), h.ids.connection, START))?.reason).toBe('outage')
    expect(await holdOf(h.payload(), h.ids.connection, new Date(START.getTime() + 3 * MIN))).toBeNull()
  })
})

describe('the poller when the budget runs low', () => {
  it('polls at most every five minutes below 20 % remaining', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const readers = { [repo]: readerOf(fake) }
    await setLimits({ limit: 5000, remaining: 900, resetAt: new Date(START.getTime() + 60 * MIN).toISOString() })
    expect((await h.sync(readers)).synced).toBe(1)
    h.later(MIN)
    expect(await h.sync(readers)).toEqual({ synced: 0, failed: 0, paused: 1 })
    h.later(5 * MIN)
    expect((await h.sync(readers)).synced).toBe(1)
  })

  it('polls every run while at least 20 % remain', async () => {
    const repo = h.fresh()
    const readers = { [repo]: readerOf(new FakeBackend({ native: true, user: 'jo' })) }
    await setLimits({ limit: 5000, remaining: 1100 })
    expect((await h.sync(readers)).synced).toBe(1)
    h.later(MIN)
    expect((await h.sync(readers)).synced).toBe(1)
  })

  it('stores the remaining budget the adapter saw for the connection', async () => {
    const headers = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4321', 'x-ratelimit-reset': '1900000000' }
    const http = new Http({
      auth: patAuth('t'),
      budgetKey: String(h.ids.connection),
      fetch: async () => new Response('{}', { status: 200, headers }),
    })
    await http.json('GET', '/x')
    await saveBudget(h.payload(), h.ids.connection)
    expect(await readLimits(h.payload(), h.ids.connection)).toMatchObject({
      limit: 5000,
      remaining: 4321,
      resetAt: '2030-03-17T17:46:40.000Z',
    })
  })
})

const typesOf = async (recordId: number) => (await readEvents(h.payload(), recordId)).map((e) => e.type)

const shipSetup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'broken', labels: ['bug'] })
  await fake.forge.createBranch(repo, 'fix')
  const headSha = fake.commit(repo, 'fix', 'a.txt', 'x')
  const pull = await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main' })
  await h.sync({ [repo]: readerOf(fake) })
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const writer = createWriter(h.payload(), { backend: async () => fake, now: () => START })
  const depsAt = (now: Date) => ({
    payload: h.payload(),
    configFor: async () => ({
      caps: { ...CAPS },
      riskAreas: [],
      deployChecks: false,
      deployNames: [],
      deployWaitMinutes: 60,
      requiredChecks: false,
      autoClose: true,
    }),
    now,
    merge: mergeVia(h.payload(), writer),
  })
  const append = (event: NewEvent) => appendEvent(h.payload(), record.id, event)
  const by = { actor: 'factory' } as const
  await append({ type: 'intake.accepted', data: {}, ...by })
  await append({ type: 'brief.submitted', data: { runId: '1' }, ...by })
  await append({ type: 'brief.approved', data: { by: 'rule' }, ...by })
  await append({ type: 'build.submitted', data: { runId: '2', patchId: 'p1', headSha, pr: pull.number }, ...by })
  await append({ type: 'checks.finished', data: { patchId: 'p1', passed: true }, ...by })
  await append({ type: 'verify.passed', data: { runId: '3', patchId: 'p1', headSha }, ...by })
  return { fake, record, depsAt }
}

describe('the merge when the forge is unavailable', () => {
  beforeEach(async () => {
    await h.rows(sql`DELETE FROM "events"`)
    await h.rows(sql`DELETE FROM "records"`)
    await h.rows(sql`UPDATE "products" SET "state" = 'active' WHERE "id" = ${h.ids.product}`)
  })

  it('waits out a used-up rate limit without a failed run or a question, then merges', async () => {
    const s = await shipSetup()
    const resetAt = new Date(START.getTime() + 10 * MIN)
    const merge = vi.spyOn(s.fake.forge, 'mergePullRequest').mockRejectedValueOnce(limitedUntil(resetAt))
    await advance(s.record.id, s.depsAt(START))
    expect((await typesOf(s.record.id)).filter((t) => t === 'run.failed' || t === 'question.asked')).toEqual([])
    expect((await readRecord(h.payload(), s.record.id)).parked).toBe(
      'Merge will be retried: GitHub limit reached, resumes at 10:10 UTC',
    )

    await advance(s.record.id, s.depsAt(new Date(START.getTime() + 5 * MIN)))
    expect(merge).toHaveBeenCalledTimes(1)

    await advance(s.record.id, s.depsAt(new Date(START.getTime() + 11 * MIN)))
    expect(merge).toHaveBeenCalledTimes(2)
    expect(await typesOf(s.record.id)).toContain('ship.merged')
    expect((await readRecord(h.payload(), s.record.id)).parked).toBeNull()
  })

  it('does not count a 5xx outage as a failed run', async () => {
    const s = await shipSetup()
    vi.spyOn(s.fake.forge, 'getPullRequest').mockRejectedValueOnce(new GithubError(503, 'GET', '/pulls/1', 'down'))
    await advance(s.record.id, s.depsAt(START))
    expect(await typesOf(s.record.id)).not.toContain('run.failed')
    const { parked } = await readRecord(h.payload(), s.record.id)
    expect(parked).toMatch(/GitHub is not answering, retrying at 10:02 UTC/)
    await advance(s.record.id, s.depsAt(new Date(START.getTime() + 3 * MIN)))
    expect(await typesOf(s.record.id)).toContain('ship.merged')
  })

  it('still fails a ship run on an error that is not the forge outage', async () => {
    const s = await shipSetup()
    vi.spyOn(s.fake.forge, 'mergePullRequest').mockRejectedValueOnce(new GithubError(422, 'PUT', '/merge', 'nope'))
    await advance(s.record.id, s.depsAt(START))
    expect((await typesOf(s.record.id)).filter((t) => t === 'run.failed')).toHaveLength(1)
  })
})
