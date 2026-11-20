import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { appendEvent, createRecord } from '../../src/core/record/store'
import { HOUR, mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_mirror_changes')
const { rows, newSource, sync, items, source, numbersOf, fresh, settle, later } = h

describe('changes on the forge', () => {
  it('follows a comment edit in place', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const tickets = fake.tickets(repo)
    const ticket = await tickets.create({ title: 'a' })
    const comment = await tickets.comment(ticket.id, 'first')
    await tickets.comment(ticket.id, 'other')
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    const bodies = async () =>
      (await rows(sql`SELECT "body" FROM "mirror_comments" ORDER BY "forge_id"`)).map((r) => r.body)
    expect(await bodies()).toEqual(['first', 'other'])
    await tickets.updateComment(ticket.id, comment.id, 'edited')
    await sync(readers)
    expect(await bodies()).toEqual(['edited', 'other'])
    await tickets.comment(ticket.id, 'third')
    await sync(readers)
    expect(await bodies()).toEqual(['edited', 'other', 'third'])
  })

  it('records a closed issue with its closing time', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const ticket = await fake.tickets(repo).create({ title: 'a' })
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    expect((await items(repo))[0]).toMatchObject({ state: 'open', forge_closed_at: null })
    await fake.tickets(repo).close(ticket.id, 'completed')
    await sync(readers)
    const [row] = await items(repo)
    expect(row?.state).toBe('closed')
    expect(row?.forge_closed_at).not.toBeNull()
  })

  it('marks an item that vanished from the forge as gone and clears it when it returns', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.tickets(repo).create({ title: 'keeps' })
    const vanish = await fake.tickets(repo).create({ title: 'vanishes' })
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    const gone = async () =>
      Object.fromEntries((await items(repo)).map((r) => [String(r.title), r.gone_at !== null]))
    expect(await gone()).toEqual({ keeps: false, vanishes: false })

    fake.hideTicket(repo, vanish.number)
    later(25 * HOUR)
    await sync(readers)
    expect(await gone()).toEqual({ keeps: false, vanishes: true })

    fake.hideTicket(repo, vanish.number, false)
    later(25 * HOUR)
    await sync(readers)
    expect(await gone()).toEqual({ keeps: false, vanishes: false })
  })

  it('does not mark an issue gone that was only closed', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const ticket = await fake.tickets(repo).create({ title: 'a' })
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    await fake.tickets(repo).close(ticket.id, 'completed')
    later(25 * HOUR)
    await sync(readers)
    expect((await items(repo))[0]).toMatchObject({ state: 'closed', gone_at: null })
  })

  it('catches an item the forge index showed late without moving the cursor back', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const late = await fake.tickets(repo).create({ title: 'late' })
    await fake.tickets(repo).create({ title: 'newer' })
    fake.hideTicket(repo, late.number)
    const sourceId = await newSource(repo)
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    const cursor = (await source(sourceId))?.cursor
    expect(cursor).toBeTruthy()
    expect(await numbersOf(repo)).toEqual([2])

    fake.hideTicket(repo, late.number, false)
    later(2 * HOUR)
    await sync(readers)
    expect(await numbersOf(repo)).toEqual([1, 2])
    const after = await source(sourceId)
    expect(after?.cursor).toBe(cursor)
    expect(after?.lookback_at).not.toBeNull()
  })
})

describe('pull requests', () => {
  it('mirrors an open pull request with its checks and refreshes pending checks of a ticket', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.forge.createBranch(repo, 'fix')
    const sha = fake.commit(repo, 'fix', 'a.txt', 'x')
    const issue = await fake.tickets(repo).create({ title: 'bug' })
    const pull = await fake.forge.openPullRequest(repo, {
      title: 'Fix',
      body: `Closes #${issue.number}`,
      head: 'fix',
      base: 'main',
    })
    fake.setChecks(repo, sha, [{ name: 'ci', status: 'in_progress', conclusion: null }])
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    const [row] = await rows(sql`SELECT * FROM "mirror_items" WHERE "repo" = ${repo} AND "kind" = 'pr'`)
    expect(row).toMatchObject({
      number: String(pull.number),
      state: 'open',
      head_sha: sha,
      head_ref: 'fix',
      closes: [issue.number],
      draft: false,
      author_trusted: true,
    })
    const checks = () =>
      rows(sql`SELECT "name", "status", "conclusion" FROM "mirror_checks" WHERE "sha" = ${sha}`)
    expect(await checks()).toEqual([{ name: 'ci', status: 'in_progress', conclusion: null }])

    fake.setChecks(repo, sha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
    await sync(readers)
    expect(await checks()).toEqual([{ name: 'ci', status: 'in_progress', conclusion: null }])

    const number = Number(issue.number)
    const source = { forge: 'github' as const, repo, number, reporter: 'jo', external: false, backlog: false }
    const { workspace, product } = h.ids
    const record = await createRecord(h.payload(), { workspace, product, source, type: 'bug' })
    const data = { runId: '1', patchId: 'p1', headSha: sha, pr: pull.number }
    await appendEvent(h.payload(), record.id, { type: 'build.submitted', data, actor: 'agent' })
    await sync(readers)
    expect(await checks()).toEqual([{ name: 'ci', status: 'completed', conclusion: 'success' }])
  })

  it('learns that a pull request merged at the next daily reconcile', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.forge.createBranch(repo, 'fix')
    fake.commit(repo, 'fix', 'a.txt', 'x')
    const pull = await fake.forge.openPullRequest(repo, { title: 'Fix', head: 'fix', base: 'main' })
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    fake.merge(repo, pull.number)
    later(25 * HOUR)
    await sync(readers)
    expect((await items(repo))[0]).toMatchObject({ kind: 'pr', state: 'merged', gone_at: null })
  })
})
