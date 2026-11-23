import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISCLOSURE, disclosed } from '../../src/core/forge/disclosure'
import { ProductObserving, WrongItemKind } from '../../src/core/forge/errors'
import { createWriter } from '../../src/core/forge/writer'
import { createRecord, readEvents } from '../../src/core/record/store'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_writer')

const setup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'broken', labels: ['bug', 'bauherr:stage:intake'] })
  await fake.forge.createBranch(repo, 'fix')
  const sha = fake.commit(repo, 'fix', 'a.txt', 'x')
  await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main' })
  await h.sync({ [repo]: readerOf(fake) })
  const items = await h.items(repo)
  const pick = (kind: string) => Number(items.find((r) => r.kind === kind)?.id)
  const record = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'bug',
  })
  const backend = vi.fn(async () => fake)
  const now = () => new Date('2026-11-19T12:00:00Z')
  const writer = createWriter(h.payload(), { backend, now })
  const target = (kind: 'issue' | 'pr') => ({ recordId: record.id, itemId: pick(kind) })
  return { repo, fake, issue, sha, record, backend, writer, target }
}

const at = () => ({ workspace: h.ids.workspace, product: h.ids.product })
const issueInput = { title: 'Prevent by a check: x', body: 'The memory.', reference: 'bauherr-memory-1' }

const setState = (state: string) =>
  h.rows(sql`UPDATE "products" SET "state" = ${state} WHERE "id" = ${h.ids.product}`)

const labelsOf = async (fake: FakeBackend, repo: string, id: string) => (await fake.tickets(repo).get(id)).labels
const writeEvents = async (recordId: number) =>
  (await readEvents(h.payload(), recordId)).filter((e) => e.type.startsWith('forge.write.')).map((e) => e.type)

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await setState('active')
})

describe('an observing Product', () => {
  it('causes no forge call and no event for any write', async () => {
    const s = await setup()
    await setState('observing')
    const calls = [
      () => s.writer.setStageLabel(s.target('issue'), 'brief'),
      () => s.writer.upsertStatusComment(s.target('issue'), 'status'),
      () => s.writer.postQuestion(s.target('issue'), 'why?'),
      () => s.writer.mergePullRequest(s.target('pr'), s.sha),
      () => s.writer.closeIssue(s.target('issue'), 'completed'),
      () => s.writer.reviewPullRequest(s.target('pr'), 'findings'),
      () => s.writer.openPullRequest(s.target('issue'), { title: 't', body: 'b', head: 'fix', base: 'main' }),
      () => s.writer.openIssue(at(), issueInput),
    ]
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ProductObserving)
    expect(s.backend).not.toHaveBeenCalled()
    expect(await writeEvents(s.record.id)).toEqual([])
  })
})

describe('setStageLabel', () => {
  it('swaps the stage label, keeps a label a person set, and updates the mirror', async () => {
    const s = await setup()
    await s.fake.tickets(s.repo).addLabels(s.issue.id, ['needs-review', 'bauherr:approved:plan'])
    await s.writer.setStageLabel(s.target('issue'), 'brief')
    const labels = await labelsOf(s.fake, s.repo, s.issue.id)
    expect([...labels].sort()).toEqual(['bauherr:approved:plan', 'bauherr:stage:brief', 'bug', 'needs-review'])
    const row = (await h.items(s.repo)).find((r) => r.kind === 'issue')
    expect(row?.labels).toEqual(labels)
    expect(await writeEvents(s.record.id)).toEqual(['forge.write.started', 'forge.write.done'])
  })

  it('refuses an item that is a pull request', async () => {
    const s = await setup()
    await expect(s.writer.setStageLabel(s.target('pr'), 'brief')).rejects.toBeInstanceOf(WrongItemKind)
  })
})

describe('comments', () => {
  const lastComment = async (s: Awaited<ReturnType<typeof setup>>) =>
    (await s.fake.tickets(s.repo).listComments(s.issue.id)).at(-1)

  it('starts every body with the AI disclosure line, once', async () => {
    const s = await setup()
    await s.writer.postQuestion(s.target('issue'), 'Which browser?')
    expect((await lastComment(s))?.body).toBe(`${DISCLOSURE}\n\nWhich browser?`)
    await s.writer.postQuestion(s.target('issue'), `${DISCLOSURE}\n\nAgain?`)
    expect((await lastComment(s))?.body).toBe(`${DISCLOSURE}\n\nAgain?`)
    const mirrored = await h.rows(sql`SELECT "body" FROM "mirror_comments" ORDER BY "id"`)
    expect(mirrored.map((r) => String(r.body).startsWith(DISCLOSURE))).toEqual([true, true])
  })

  it('edits one status comment in place and writes nothing for an unchanged body', async () => {
    const s = await setup()
    await s.writer.upsertStatusComment(s.target('issue'), 'Working on it')
    await s.writer.upsertStatusComment(s.target('issue'), 'Working on it')
    expect(await writeEvents(s.record.id)).toEqual(['forge.write.started', 'forge.write.done'])
    await s.writer.upsertStatusComment(s.target('issue'), 'Done')
    const comments = await s.fake.tickets(s.repo).listComments(s.issue.id)
    expect(comments.map((c) => c.body)).toEqual([`${DISCLOSURE}\n\nDone`])
    const stored = await h.rows(sql`SELECT "status_comment_id", "status_comment_hash" FROM "records"`)
    expect(stored[0]?.status_comment_id).toBe(comments[0]?.id)
    expect(await h.rows(sql`SELECT "body" FROM "mirror_comments"`)).toEqual([{ body: `${DISCLOSURE}\n\nDone` }])
  })
})

describe('mergePullRequest and closeIssue', () => {
  it('merges only the expected head commit', async () => {
    const s = await setup()
    await expect(s.writer.mergePullRequest(s.target('pr'), 'stale')).rejects.toThrow(/not stale/)
    expect(await writeEvents(s.record.id)).toEqual(['forge.write.started', 'forge.write.failed'])
    await s.writer.mergePullRequest(s.target('pr'), s.sha)
    const pr = (await s.fake.forge.listPullRequests(s.repo, 'all'))[0]
    expect(pr?.state).toBe('merged')
    expect((await h.items(s.repo)).find((r) => r.kind === 'pr')?.state).toBe('merged')
  })

  it('closes the issue and records it in the mirror', async () => {
    const s = await setup()
    await s.writer.closeIssue(s.target('issue'), 'not_planned')
    expect((await s.fake.tickets(s.repo).get(s.issue.id)).state).toBe('closed')
    expect((await h.items(s.repo)).find((r) => r.kind === 'issue')?.state).toBe('closed')
  })
})

describe('openPullRequest', () => {
  it('opens the pull request with the disclosure line on top and mirrors it', async () => {
    const s = await setup()
    await s.fake.forge.createBranch(s.repo, 'bauherr/1-run')
    const pull = await s.writer.openPullRequest(s.target('issue'), {
      title: 'Fix it',
      body: 'Goal\n\nCloses #1',
      head: 'bauherr/1-run',
      base: 'main',
    })
    expect(pull.body).toBe(`${DISCLOSURE}\n\nGoal\n\nCloses #1`)
    const mirrored = (await h.items(s.repo)).find((r) => r.kind === 'pr' && Number(r.number) === pull.number)
    expect(mirrored?.head_ref).toBe('bauherr/1-run')
    expect(await writeEvents(s.record.id)).toEqual(['forge.write.started', 'forge.write.done'])
  })

  it('refuses an item that is a pull request', async () => {
    const s = await setup()
    await expect(
      s.writer.openPullRequest(s.target('pr'), { title: 't', body: 'b', head: 'fix', base: 'main' }),
    ).rejects.toBeInstanceOf(WrongItemKind)
  })
})

describe('openIssue', () => {
  const issuesOf = async (s: Awaited<ReturnType<typeof setup>>) => s.fake.tickets(s.repo).list({ state: 'all' })

  it('opens one issue with the disclosure line on top and the reference at the end, and mirrors it', async () => {
    const s = await setup()
    const before = (await issuesOf(s)).length
    const list = vi.spyOn(s.fake.tickets(s.repo), 'list')
    const issue = await s.writer.openIssue(at(), issueInput)
    expect(list).not.toHaveBeenCalled()
    expect(issue.title).toBe('Prevent by a check: x')
    expect(issue.body).toBe(`${DISCLOSURE}\n\nThe memory.\n\nReference: bauherr-memory-1`)
    expect((await issuesOf(s)).length).toBe(before + 1)
    const mirrored = (await h.items(s.repo)).find((r) => Number(r.number) === issue.number)
    expect(mirrored).toMatchObject({ kind: 'issue', title: 'Prevent by a check: x', state: 'open' })
  })

  it('finds the issue of an interrupted write instead of opening a second one', async () => {
    const s = await setup()
    const half = await s.fake.tickets(s.repo).create({
      title: issueInput.title,
      body: disclosed(`${issueInput.body}\n\nReference: ${issueInput.reference}`),
    })
    await h.sync({ [s.repo]: readerOf(s.fake) })
    const before = (await issuesOf(s)).length
    const list = vi.spyOn(s.fake.tickets(s.repo), 'list')
    const found = await s.writer.openIssue(at(), issueInput)
    await s.writer.openIssue(at(), issueInput)
    expect(list).not.toHaveBeenCalled()
    expect(found.number).toBe(half.number)
    expect((await issuesOf(s)).length).toBe(before)
    expect((await h.items(s.repo)).filter((r) => Number(r.number) === half.number)).toHaveLength(1)
  })

  it('opens a new issue for another reference, and does not confuse memory 1 with memory 12', async () => {
    const s = await setup()
    const first = await s.writer.openIssue(at(), issueInput)
    const twelfth = await s.writer.openIssue(at(), { ...issueInput, reference: 'bauherr-memory-12' })
    const again = await s.writer.openIssue(at(), { ...issueInput, reference: 'bauherr-memory-2' })
    expect(new Set([first.number, twelfth.number, again.number]).size).toBe(3)
  })
})

describe('reviewPullRequest', () => {
  it('posts one comment with the disclosure line on top, as a review without an approval, and mirrors it', async () => {
    const s = await setup()
    await s.writer.reviewPullRequest(s.target('pr'), 'one finding\n\n- the list drops a row')
    const [pull] = await s.fake.forge.listOpenPullRequests(s.repo, 1, 10)
    const comments = await s.fake.forge.listPullRequestComments(s.repo, pull?.number ?? 0)
    expect(comments.map((c) => c.body)).toEqual([`${DISCLOSURE}\n\none finding\n\n- the list drops a row`])
    expect(await writeEvents(s.record.id)).toEqual(['forge.write.started', 'forge.write.done'])
    const mirrored = await h.rows(sql`SELECT 1 FROM "mirror_comments" WHERE "body" LIKE '%drops a row%'`)
    expect(mirrored).toHaveLength(1)
  })

  it('refuses an item that is an issue', async () => {
    const s = await setup()
    await expect(s.writer.reviewPullRequest(s.target('issue'), 'findings')).rejects.toBeInstanceOf(WrongItemKind)
  })
})

describe('a failed call', () => {
  it('leaves forge.write.failed with the reason and rethrows', async () => {
    const s = await setup()
    const tickets = s.fake.tickets(s.repo)
    vi.spyOn(tickets, 'addLabels').mockRejectedValue(new Error('forge said no'))
    vi.spyOn(s.fake, 'tickets').mockReturnValue(tickets)
    await expect(s.writer.setStageLabel(s.target('issue'), 'brief')).rejects.toThrow('forge said no')
    const failed = (await readEvents(h.payload(), s.record.id)).find((e) => e.type === 'forge.write.failed')
    if (failed?.type !== 'forge.write.failed') throw new Error('no failed event')
    expect(failed.data.kind).toBe('stage-label')
    expect(failed.data.reason).toContain('forge said no')
    expect(await h.rows(sql`SELECT 1 FROM "mirror_items" WHERE "labels" @> '["bauherr:stage:brief"]'`)).toEqual([])
  })

  it('never changes a record of another Product', async () => {
    const s = await setup()
    const other = Number(
      (await h.rows(sql`INSERT INTO "products" ("name", "slug", "workspace_id", "state", "updated_at", "created_at")
        VALUES ('q', 'q', ${h.ids.workspace}, 'active', now(), now()) RETURNING "id"`))[0]?.id,
    )
    const foreign = await createRecord(h.payload(), {
      workspace: h.ids.workspace,
      product: other,
      source: { forge: 'github', repo: 'x/y', number: 1, reporter: 'jo', external: false, backlog: false },
      type: 'bug',
    })
    const target = { recordId: foreign.id, itemId: s.target('issue').itemId }
    await expect(s.writer.closeIssue(target, 'completed')).rejects.toThrow(/does not exist/)
    expect(s.backend).not.toHaveBeenCalled()
  })
})
