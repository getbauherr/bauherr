import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { pullsAwaitingChecks } from '../../src/core/mirror/store'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_mirror_awaiting_checks')

const setup = async () => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  await fake.forge.createBranch(repo, 'fix')
  const sha = fake.commit(repo, 'fix', 'a.txt', 'x')
  const pull = await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main' })
  const readers = { [repo]: readerOf(fake) }
  await h.settle(readers)
  const source = Number((await h.rows(sql`SELECT "id" FROM "ticket_sources" WHERE "repo" = ${repo}`))[0]?.id)
  const awaiting = async () => [...(await pullsAwaitingChecks(h.payload(), source))]
  return { repo, fake, sha, pull, readers, awaiting }
}

const check = (status: string, conclusion: string | null) => [{ name: 'ci', status, conclusion }]

describe('which pull requests await checks', () => {
  it('lists an open pull request with no check row for its head commit', async () => {
    const s = await setup()
    expect(await s.awaiting()).toEqual([s.pull.number])
  })

  it('lists it while a check is not completed and stops once all are completed', async () => {
    const s = await setup()
    s.fake.setChecks(s.repo, s.sha, check('in_progress', null))
    await h.sync(s.readers)
    expect(await s.awaiting()).toEqual([s.pull.number])
    s.fake.setChecks(s.repo, s.sha, check('completed', 'success'))
    await h.sync(s.readers)
    expect(await s.awaiting()).toEqual([])
  })

  it('does not list a pull request that is not open', async () => {
    const s = await setup()
    await h.rows(sql`UPDATE "mirror_items" SET "state" = 'merged' WHERE "repo" = ${s.repo} AND "kind" = 'pr'`)
    expect(await s.awaiting()).toEqual([])
  })

  it('picks up checks that appear after the pull request was first mirrored', async () => {
    const s = await setup()
    s.fake.setChecks(s.repo, s.sha, check('completed', 'success'))
    await h.sync(s.readers)
    const rows = await h.rows(sql`SELECT "status" FROM "mirror_checks" WHERE "sha" = ${s.sha}`)
    expect(rows).toHaveLength(1)
  })
})
