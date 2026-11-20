import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { enterIssues } from '../../src/core/intake/enter'
import { readEvents } from '../../src/core/record/store'
import { firstLook } from '../../src/core/views/first-look'
import { ticket } from '../../src/core/views/ticket'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, clock, product } = intakeHarness('core_intake_adopt_enter')

const forge = () => new FakeBackend({ native: true, user: 'jo', users: ['jo', 'sam'], trusted: ['jo'], bots: ['robo'] })
const recordsOf = (repo: string) =>
  h.rows(sql`SELECT "id", "data" FROM "records" WHERE "source_repo" = ${repo} ORDER BY "source_number"`)
const typesOf = async (id: number) => (await readEvents(h.payload(), id)).map((e) => e.type)

const connected = () => product(sql`"connected_at" = '2026-06-01T00:00:00Z'::timestamptz`)

const openPull = async (fake: FakeBackend, repo: string, branch: string, body: string, author = 'jo') => {
  fake.actingAs = author
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, `${branch}.txt`, branch)
  const pull = await fake.forge.openPullRequest(repo, { title: `pull ${branch}`, head: branch, base: 'main', body })
  fake.actingAs = 'factory'
  return pull
}

const setup = async (issues: { title: string; author?: string; labels?: string[] }[] = [{ title: 'broken' }]) => {
  const repo = h.fresh()
  const fake = forge()
  for (const issue of issues) {
    fake.actingAs = issue.author ?? 'jo'
    await fake.tickets(repo).create({ title: issue.title, labels: issue.labels ?? [] })
  }
  fake.actingAs = 'factory'
  return { repo, fake }
}

const settle = async (repo: string, fake: FakeBackend) => {
  await h.settle({ [repo]: readerOf(fake) })
}

describe('adopting pull requests', () => {
  it('creates one record at Verify-bound intake for a pull request that was open before connecting, once', async () => {
    const { repo, fake } = await setup()
    const pull = await openPull(fake, repo, 'fix', 'Closes #1')
    await settle(repo, fake)
    await connected()
    expect(await enterIssues(deps())).toHaveLength(1)
    expect(await enterIssues(deps())).toEqual([])
    const [row] = await recordsOf(repo)
    expect(await recordsOf(repo)).toHaveLength(1)
    expect(row?.data).toMatchObject({
      source: { repo, number: 1, reporter: 'jo', external: false, backlog: true, adopted: { pr: pull.number } },
    })
    const id = Number(row?.id)
    expect(await typesOf(id)).toEqual(['pull.adopted', 'run.started'])
    const events = await readEvents(h.payload(), id)
    expect(events[0]?.data).toEqual({ pr: pull.number, headSha: pull.headSha, patchId: `adopted:${pull.headSha}` })
    const stored = await h.rows(sql`SELECT "stage", "pr" FROM "records" WHERE "id" = ${id}`)
    expect(stored[0]).toMatchObject({ stage: 'brief', pr: String(pull.number) })
  })

  it('does not adopt a pull request opened after connecting: the issue enters as usual', async () => {
    const { repo, fake } = await setup()
    await openPull(fake, repo, 'fix', 'Closes #1')
    await settle(repo, fake)
    await product(sql`"connected_at" = '2025-01-01T00:00:00Z'::timestamptz`)
    expect(await enterIssues(deps())).toHaveLength(1)
    const [row] = await recordsOf(repo)
    expect((row?.data as { source: { adopted?: unknown } }).source.adopted).toBeUndefined()
    expect(await typesOf(Number(row?.id))).toEqual(['run.started'])
  })

  it.each([
    ['an outside author', 'eve', 'Closes #1', []],
    ['a bot', 'robo', 'Closes #1', []],
    ['a pull request that names no issue', 'jo', 'No link', []],
    ['an issue with an excluded label', 'jo', 'Closes #1', ['wontfix']],
  ])('does not adopt %s', async (_name, author, body, labels) => {
    const { repo, fake } = await setup([{ title: 'broken', labels }])
    fake.actingAs = author
    await fake.forge.createBranch(repo, 'fix')
    fake.commit(repo, 'fix', 'a.txt', 'x')
    await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main', body })
    fake.actingAs = 'factory'
    await settle(repo, fake)
    await connected()
    await product(sql`"intake_excluded_labels" = '["wontfix"]'::jsonb`)
    await enterIssues(deps())
    for (const row of await recordsOf(repo)) {
      expect((row.data as { source: { adopted?: unknown } }).source.adopted).toBeUndefined()
    }
  })

  it('does not adopt a pull request that closes two open issues', async () => {
    const { repo, fake } = await setup([{ title: 'a' }, { title: 'b' }])
    await openPull(fake, repo, 'fix', 'Closes #1 and closes #2')
    await settle(repo, fake)
    await connected()
    await enterIssues(deps())
    for (const row of await recordsOf(repo)) {
      expect((row.data as { source: { adopted?: unknown } }).source.adopted).toBeUndefined()
    }
  })

  it('adopts an assigned issue, the oldest pull request wins, and the other is listed on the ticket page', async () => {
    const { repo, fake } = await setup()
    await fake.tickets(repo).claim('1', 'sam')
    const first = await openPull(fake, repo, 'first', 'Closes #1')
    const second = await openPull(fake, repo, 'second', 'Fixes #1', 'sam')
    await settle(repo, fake)
    await connected()
    expect(await enterIssues(deps())).toHaveLength(1)
    const [row] = await recordsOf(repo)
    expect(row?.data).toMatchObject({ source: { adopted: { pr: first.number } } })
    const view = await ticket(h.payload(), { workspace: h.ids.workspace, recordId: Number(row?.id) })
    expect(view.adopted).toEqual({ pr: first.number, author: 'jo' })
    expect(view.otherPulls).toEqual([
      { number: second.number, title: 'pull second', url: second.url, author: 'sam', state: 'open' },
    ])
  })

  it('creates the record for an observing Product and writes nothing to the forge', async () => {
    const { repo, fake } = await setup()
    const pull = await openPull(fake, repo, 'fix', 'Closes #1')
    await settle(repo, fake)
    await connected()
    await enterIssues(deps())
    const [row] = await recordsOf(repo)
    expect((await typesOf(Number(row?.id))).some((t) => t.startsWith('forge.write.'))).toBe(false)
    expect((await fake.tickets(repo).get('1')).labels).toEqual([])
    expect(await fake.forge.listPullRequestComments(repo, pull.number)).toEqual([])
  })

  it('counts adoptable pull requests in the first look, and adopted ones after they entered', async () => {
    const { repo, fake } = await setup([{ title: 'a' }, { title: 'b' }])
    await openPull(fake, repo, 'one', 'Closes #1')
    await openPull(fake, repo, 'two', 'No link')
    await settle(repo, fake)
    await connected()
    const look = () => firstLook(h.payload(), { workspace: h.ids.workspace, product: h.ids.product, now: clock.now })
    expect((await look()).pullRequests).toEqual({ open: 2, closingAnIssue: 1, notClosingAnIssue: 1 })
    await enterIssues(deps())
    expect((await look()).pullRequests).toEqual({ open: 2, closingAnIssue: 1, notClosingAnIssue: 1 })
  })

  it('enters nothing of a source before its import is complete, so an issue never becomes a second fix', async () => {
    const { repo, fake } = await setup()
    const pull = await openPull(fake, repo, 'fix', 'Closes #1')
    await connected()
    let hidden = true
    const real = readerOf(fake)
    const reader = {
      tickets: real.tickets,
      forge: {
        ...real.forge,
        listOpenPullRequests: (repoName: string, page: number, perPage: number) =>
          hidden ? Promise.resolve([]) : real.forge.listOpenPullRequests(repoName, page, perPage),
      },
    }
    await h.sync({ [repo]: reader })
    expect(await recordsOf(repo)).toHaveLength(0)
    expect(await enterIssues(deps())).toEqual([])
    hidden = false
    await h.settle({ [repo]: reader })
    expect(await enterIssues(deps())).toHaveLength(1)
    const rows = await recordsOf(repo)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.data).toMatchObject({ source: { adopted: { pr: pull.number } } })
  })
})
