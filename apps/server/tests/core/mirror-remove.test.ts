import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { deleteProductMirror, deleteSourceMirror } from '../../src/core/mirror/store'
import { id, mirrorHarness, o, readerOf } from './mirror-harness'

const h = mirrorHarness('core_mirror_remove')
const { rows, sync, fresh, ids } = h

const fill = async (repo: string) => {
  const fake = new FakeBackend({ native: true, user: 'jo' })
  const issue = await fake.tickets(repo).create({ title: 'a' })
  await fake.tickets(repo).comment(issue.id, 'hello')
  await fake.forge.createBranch(repo, 'fix')
  const sha = fake.commit(repo, 'fix', 'a.txt', 'x')
  await fake.forge.openPullRequest(repo, { title: 'p', head: 'fix', base: 'main' })
  fake.setChecks(repo, sha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  await sync({ [repo]: readerOf(fake) })
}

const counts = async (repo: string) => {
  const one = async (table: string, join: string) =>
    Number(
      (
        await rows(sql.raw(
          `SELECT count(*)::int AS n FROM "${table}" t ${join} WHERE i."repo" = '${repo}'`,
        ))
      )[0]?.n,
    )
  return {
    items: await one('mirror_items', 'JOIN "mirror_items" i ON i."id" = t."id"'),
    comments: await one('mirror_comments', 'JOIN "mirror_items" i ON i."id" = t."item_id"'),
    checks: await one('mirror_checks', 'JOIN "mirror_items" i ON i."id" = t."item_id"'),
  }
}

const sourceId = async (repo: string) =>
  Number((await rows(sql`SELECT "id" FROM "ticket_sources" WHERE "repo" = ${repo}`))[0]?.id)

describe('removing the mirror of a source', () => {
  it('lets the source be deleted and leaves no row of it, and no row of another source changed', async () => {
    const [gone, kept] = [fresh(), fresh()]
    await fill(gone)
    await fill(kept)
    const before = await counts(kept)
    expect(before).toEqual({ items: 2, comments: 1, checks: 1 })
    expect(await counts(gone)).toEqual(before)

    await expect(
      h.payload().delete({ collection: 'ticket_sources', id: await sourceId(gone), ...o }),
    ).rejects.toThrow()

    await deleteSourceMirror(h.payload(), await sourceId(gone))
    await h.payload().delete({ collection: 'ticket_sources', id: await sourceId(gone), ...o })
    expect(await counts(gone)).toEqual({ items: 0, comments: 0, checks: 0 })
    expect(await counts(kept)).toEqual(before)
  })
})

describe('removing the mirror of a Product', () => {
  it('removes the rows of that Product only, so the Product can be deleted', async () => {
    const [repo, other] = [fresh(), fresh()]
    await fill(repo)
    const second = id(
      await h.payload().create({
        collection: 'products',
        data: { name: 'two', slug: 'two', workspace: ids.workspace },
        ...o,
      }),
    )
    await rows(sql`UPDATE "ticket_sources" SET "product_id" = ${second} WHERE "repo" = ${repo}`)
    await rows(sql`UPDATE "mirror_items" SET "product_id" = ${second} WHERE "repo" = ${repo}`)
    await fill(other)
    const kept = await counts(other)

    await deleteProductMirror(h.payload(), second)
    expect(await counts(repo)).toEqual({ items: 0, comments: 0, checks: 0 })
    expect(await counts(other)).toEqual(kept)
    await h.payload().delete({ collection: 'ticket_sources', id: await sourceId(repo), ...o })
    await h.payload().delete({ collection: 'products', id: second, ...o })
  })
})
