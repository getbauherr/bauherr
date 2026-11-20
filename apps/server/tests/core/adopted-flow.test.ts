import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { decide } from '../../src/core/decide'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { sendDeferred } from '../../src/core/deferred'
import { board } from '../../src/core/views/board'
import { ticket } from '../../src/core/views/ticket'
import { groupRows } from '../../src/app/(app)/lib/inbox'
import { whoOf } from '../../src/app/(app)/lib/factory'
import { BRIEF, finding, flowHarness } from './modules-harness'

const f = flowHarness('core_adopted_flow')
const DAY = 25 * 3_600_000
const CHANGES = { verdict: 'changes', findings: [finding('open')] }

const owner = () => ({ id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] })
const stages = async (id: number) =>
  (await f.h.rows(sql`SELECT "stage" FROM "stage_runs" WHERE "record_id" = ${id} ORDER BY "id"`)).map((r) => r.stage)
const reviews = async (repo: string, pr: number) =>
  (await f.fake().forge.listPullRequestComments(repo, pr)).filter((c) => c.body.includes('asks for changes'))

const verifyResult = async (id: number, headSha: string, change: object) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(id, criterion)] })
  }
  const base = { headSha, patchId: `adopted:${headSha}`, criteria, findings: [], verdict: 'pass' }
  return { ...base, changes: [], walkthrough: [], notVerified: [], ...change }
}

const toVerify = async () => {
  const s = await f.startAdopted('active')
  await f.work(s.id, 'builder', BRIEF)
  await s.sync()
  f.green(s.repo, s.headSha)
  await s.sync()
  return s
}

const authorCommits = async (s: Awaited<ReturnType<typeof toVerify>>, file: string) => {
  f.fake().actingAs = 'jo'
  const sha = f.fake().commit(s.repo, 'fix', file, `author-${file}`)
  f.fake().actingAs = 'factory'
  await f.fake().forge.getPullRequest(s.repo, s.pr)
  await s.sync()
  f.green(s.repo, sha)
  await s.sync()
  return sha
}

describe('an adopted pull request against the fake forge', () => {
  it('goes from connect to done with one review answered by a new commit, and never builds or pushes', async () => {
    const s = await f.startAdopted('active')
    expect(await f.types(s.id)).toEqual(['pull.adopted', 'run.started'])
    expect((await f.view(s.id)).record.source).toMatchObject({ number: 1, adopted: { pr: s.pr }, backlog: true })

    await f.work(s.id, 'builder', BRIEF)
    expect(await f.types(s.id)).toContain('brief.approved')
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'agents' })
    await s.sync()
    f.green(s.repo, s.headSha)
    await s.sync()
    expect(await f.types(s.id)).toContain('checks.finished')

    const changes = await verifyResult(s.id, s.headSha, { verdict: 'changes', findings: [finding('open')] })
    await f.work(s.id, 'verifier', changes)
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'author' })
    const [review] = await reviews(s.repo, s.pr)
    expect(review?.body.startsWith(DISCLOSURE)).toBe(true)
    expect(review?.body).toContain('- The list drops the last row (repro: open the list with three rows)')

    await s.sync()
    expect(await reviews(s.repo, s.pr)).toHaveLength(1)
    const second = await authorCommits(s, 'b.txt')
    expect(await f.types(s.id)).toContain('pull.adopted')
    await f.work(s.id, 'verifier', await verifyResult(s.id, second, { findings: [finding('fixed')] }))
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
    expect((await f.fake().forge.getPullRequest(s.repo, s.pr)).state).toBe('open')
    expect(await f.types(s.id)).not.toContain('ship.merged')

    const seq = (await f.view(s.id)).card?.seq ?? -1
    await decide(s.id, owner(), { ask: 'result', choice: 'accept', seq }, f.subDeps())
    expect(await f.view(s.id)).toMatchObject({ stage: 'done', waitingOn: 'nobody' })
    const types = await f.types(s.id)
    expect(types.indexOf('result.accepted')).toBeLessThan(types.indexOf('ship.merged'))
    expect((await f.fake().forge.getPullRequest(s.repo, s.pr)).state).toBe('merged')
    expect(await stages(s.id)).toEqual(['brief', 'verify', 'verify'])
    expect(await reviews(s.repo, s.pr)).toHaveLength(1)
    expect((await f.fake().forge.getPullRequest(s.repo, s.pr)).headSha).toBe(second)
  })

  it('shows a ticket waiting on the author as adopted, with its own status word, under others', async () => {
    const s = await toVerify()
    await f.work(s.id, 'verifier', await verifyResult(s.id, s.headSha, CHANGES))
    const lanes = await board(f.h.payload(), { workspace: f.h.ids.workspace, now: f.clock.now })
    const card = lanes.stages.verify.find((c) => c.recordId === s.id)
    expect(card).toMatchObject({
      status: 'waiting-on-author',
      state: 'others',
      adopted: { pr: s.pr, author: 'jo' },
    })
    expect(card && whoOf(card)).toBe('others')
    expect(groupRows(lanes).others.some((row) => row.kind === 'ticket' && row.card.recordId === s.id)).toBe(true)
    const view = await ticket(f.h.payload(), { workspace: f.h.ids.workspace, recordId: s.id })
    expect(view).toMatchObject({ status: 'waiting-on-author', adopted: { pr: s.pr, author: 'jo' } })
    expect(view.pullRequest).toMatchObject({ number: s.pr, author: 'jo' })
  })

  it('posts the note of a send-back as a review comment and waits on the author', async () => {
    const s = await toVerify()
    await f.work(s.id, 'verifier', await verifyResult(s.id, s.headSha, {}))
    const seq = (await f.view(s.id)).card?.seq ?? -1
    const note = 'The empty state still needs a message'
    await decide(s.id, owner(), { ask: 'result', choice: 'send-back', note, seq }, f.subDeps())
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'author', card: null })
    const comments = await f.fake().forge.listPullRequestComments(s.repo, s.pr)
    expect(comments.filter((c) => c.body.startsWith(DISCLOSURE) && c.body.includes(note))).toHaveLength(1)
    expect((await f.fake().forge.getPullRequest(s.repo, s.pr)).state).toBe('open')
    await authorCommits(s, 'b.txt')
    expect(await f.view(s.id)).toMatchObject({ stage: 'verify', waitingOn: 'agents' })
    expect(await stages(s.id)).toEqual(['brief', 'verify', 'verify'])
  })

  it('closes the ticket when the pull request is closed without a merge', async () => {
    const s = await toVerify()
    await f.fake().forge.closePullRequest(s.repo, s.pr)
    f.h.later(DAY)
    await s.sync()
    expect(await f.types(s.id)).toContain('ticket.closed')
    expect(await f.view(s.id)).toMatchObject({ waitingOn: 'nobody' })
  })

  it('counts a merge by a person as merged and still asks the owner at the Result card', async () => {
    const s = await toVerify()
    await f.fake().forge.mergePullRequest(s.repo, s.pr, { method: 'squash', expectSha: s.headSha })
    f.h.later(DAY)
    await s.sync()
    expect(await f.types(s.id)).toContain('ship.merged')
    await f.work(s.id, 'verifier', await verifyResult(s.id, s.headSha, {}))
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner', card: { card: 'result' } })
    expect(await f.types(s.id)).not.toContain('ticket.closed')
    const seq = (await f.view(s.id)).card?.seq ?? -1
    await decide(s.id, owner(), { ask: 'result', choice: 'accept', seq }, f.subDeps())
    expect(await f.view(s.id)).toMatchObject({ stage: 'done' })
  })

  it('creates the record for an observing Product and defers the review until it is active', async () => {
    const s = await f.startAdopted('observing')
    await f.work(s.id, 'builder', BRIEF)
    await s.sync()
    f.green(s.repo, s.headSha)
    await s.sync()
    await f.work(s.id, 'verifier', await verifyResult(s.id, s.headSha, CHANGES))
    expect(await f.types(s.id)).toContain('forge.write.deferred')
    expect(await reviews(s.repo, s.pr)).toHaveLength(0)
    await f.h.rows(sql`UPDATE "products" SET "state" = 'active' WHERE "id" = ${f.h.ids.product}`)
    await sendDeferred(f.subDeps(), f.h.ids.product)
    expect(await reviews(s.repo, s.pr)).toHaveLength(1)
  })
})
