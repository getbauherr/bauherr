import { FakeBackend, GithubError } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advance } from '../../src/core/engine'
import { createWriter } from '../../src/core/forge/writer'
import { CAPS } from '../../src/core/caps'
import type { NewEvent } from '../../src/core/record/store'
import { appendEvent, createRecord, readEvents, readRecord } from '../../src/core/record/store'
import { mergeVia } from '../../src/jobs/engine-deps'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_merge_transient')

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
    configFor: async () => ({
      caps: { ...CAPS },
      riskAreas: [],
      deployChecks: false,
      deployNames: [],
      deployWaitMinutes: 60,
      requiredChecks: false,
      autoClose: true,
    }),
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


const MERGE_IN_PROGRESS = '{"message":"Merge already in progress"}'
const failureOf = async (id: number) => (await readEvents(h.payload(), id)).filter((e) => e.type === 'run.failed')
const typesOf = async (id: number) => (await readEvents(h.payload(), id)).map((e) => e.type)
const parkedOf = async (id: number) => (await readRecord(h.payload(), id)).parked

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active' WHERE "id" = ${h.ids.product}`)
})

describe('the merge when the forge answers with a transient error', () => {
  it('carries on as merged when a 502 hid a merge that went through', async () => {
    const s = await setup()
    await s.verified(s.pull.number, s.headSha)
    const merge = s.fake.forge.mergePullRequest.bind(s.fake.forge)
    vi.spyOn(s.fake.forge, 'mergePullRequest').mockImplementationOnce(async (...args) => {
      await merge(...args)
      throw new GithubError(502, 'PUT', `/repos/${s.repo}/pulls/${s.pull.number}/merge`, 'Server Error')
    })
    await advance(s.record.id, s.deps)
    expect(await typesOf(s.record.id)).toContain('ship.merged')
    expect(await failureOf(s.record.id)).toHaveLength(0)
    expect(await parkedOf(s.record.id)).toBeNull()
  })

  it('neither fails nor asks while the pull request is open after "Merge already in progress"', async () => {
    const s = await setup()
    await s.verified(s.pull.number, s.headSha)
    const merge = vi.spyOn(s.fake.forge, 'mergePullRequest').mockRejectedValueOnce(
      new GithubError(405, 'PUT', `/repos/${s.repo}/pulls/${s.pull.number}/merge`, MERGE_IN_PROGRESS),
    )
    await advance(s.record.id, s.deps)
    expect(await failureOf(s.record.id)).toHaveLength(0)
    expect(await typesOf(s.record.id)).not.toContain('question.asked')
    expect(await parkedOf(s.record.id)).toMatch(/Merge will be retried/)
    await advance(s.record.id, s.deps)
    expect(merge).toHaveBeenCalledTimes(2)
    expect(await typesOf(s.record.id)).toContain('ship.merged')
    expect(await parkedOf(s.record.id)).toBeNull()
  })

  it.each([422, 404])('keeps a %i as a failed ship run', async (status) => {
    const s = await setup()
    await s.verified(s.pull.number, s.headSha)
    vi.spyOn(s.fake.forge, 'mergePullRequest').mockRejectedValueOnce(
      new GithubError(status, 'PUT', `/repos/${s.repo}/pulls/${s.pull.number}/merge`, 'nope'),
    )
    await advance(s.record.id, s.deps)
    expect(await failureOf(s.record.id)).toHaveLength(1)
    expect(await parkedOf(s.record.id)).toBeNull()
  })
})
