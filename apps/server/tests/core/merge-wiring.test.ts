import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { advance } from '../../src/core/engine'
import { HeadMoved, ProductObserving } from '../../src/core/forge/errors'
import { createWriter } from '../../src/core/forge/writer'
import { CAPS } from '../../src/core/caps'
import type { NewEvent } from '../../src/core/record/store'
import { appendEvent, createRecord, readEvents, readRecord } from '../../src/core/record/store'
import { mergeVia } from '../../src/jobs/engine-deps'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_merge_wiring')

const setup = async () => {
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
  const writer = createWriter(h.payload(), { backend: async () => fake, now: () => new Date('2026-11-19T12:00:00Z') })
  const deps = {
    payload: h.payload(),
    configFor: async () => ({ caps: { ...CAPS }, riskAreas: [], productionGate: false, deployChecks: false }),
    now: new Date('2026-11-19T12:00:00Z'),
    merge: mergeVia(h.payload(), writer),
  }
  const append = (event: NewEvent) => appendEvent(h.payload(), record.id, event)
  const verified = async (pr: number, verifiedHead: string) => {
    const by = { actor: 'factory' } as const
    await append({ type: 'intake.accepted', data: {}, ...by })
    await append({ type: 'brief.submitted', data: { runId: '1' }, ...by })
    await append({ type: 'brief.approved', data: { by: 'rule' }, ...by })
    await append({ type: 'build.submitted', data: { runId: '2', patchId: 'p1', headSha, pr }, ...by })
    await append({ type: 'checks.finished', data: { patchId: 'p1', passed: true }, ...by })
    await append({ type: 'verify.passed', data: { runId: '3', patchId: 'p1', headSha: verifiedHead }, ...by })
  }
  return { repo, fake, record, headSha, pull, deps, verified }
}

const setState = (state: string) =>
  h.rows(sql`UPDATE "products" SET "state" = ${state} WHERE "id" = ${h.ids.product}`)
const typesOf = async (id: number) => (await readEvents(h.payload(), id)).map((e) => e.type)
const failureOf = async (id: number) => (await readEvents(h.payload(), id)).filter((e) => e.type === 'run.failed')

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await setState('active')
})

describe('the merge of the engine against the fake forge', () => {
  it('merges the verified pull request and records the merge commit', async () => {
    const s = await setup()
    await s.verified(s.pull.number, s.headSha)
    await advance(s.record.id, s.deps)
    const events = await readEvents(h.payload(), s.record.id)
    const merged = events.find((e) => e.type === 'ship.merged')
    expect(merged?.type === 'ship.merged' && merged.data.sha).toMatch(/\S/)
    expect(await typesOf(s.record.id)).toContain('forge.write.done')
    expect((await s.fake.forge.getPullRequest(s.repo, s.pull.number)).state).toBe('merged')
    expect((await readRecord(h.payload(), s.record.id)).card).toMatchObject({ card: 'result' })
  })

  it('refuses a head that moved since verification and ends as a failed ship run', async () => {
    const s = await setup()
    await s.verified(s.pull.number, 'verified-earlier')
    const target = { recordId: s.record.id, source: s.record.record.source, pr: s.pull.number }
    await expect(s.deps.merge({ ...target, headSha: 'x' })).rejects.toBeInstanceOf(HeadMoved)
    await advance(s.record.id, s.deps)
    expect((await s.fake.forge.getPullRequest(s.repo, s.pull.number)).state).not.toBe('merged')
    const failed = await failureOf(s.record.id)
    expect(failed[0]).toMatchObject({ data: { stage: 'ship', runId: 'merge' } })
    expect(failed[0]?.type === 'run.failed' && failed[0].data.reason).toMatch(/head is/)
  })

  it('ends as a failed ship run with a clear text when the pull request is not mirrored yet', async () => {
    const s = await setup()
    await s.verified(999, s.headSha)
    await advance(s.record.id, s.deps)
    const failed = await failureOf(s.record.id)
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0]?.type === 'run.failed' && failed[0].data.reason).toBe(
      `Pull request ${s.repo}#999 is not in the mirror yet: wait for the next sync.`,
    )
  })

  it('surfaces an observing Product as a failed ship run', async () => {
    const s = await setup()
    await setState('observing')
    await s.verified(s.pull.number, s.headSha)
    const target = { recordId: s.record.id, source: s.record.record.source, pr: s.pull.number }
    await expect(s.deps.merge({ ...target, headSha: s.headSha })).rejects.toBeInstanceOf(ProductObserving)
    await advance(s.record.id, s.deps)
    expect((await failureOf(s.record.id)).length).toBeGreaterThan(0)
    expect((await s.fake.forge.getPullRequest(s.repo, s.pull.number)).state).not.toBe('merged')
  })
})
