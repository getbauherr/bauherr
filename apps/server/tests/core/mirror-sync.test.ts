import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { itemFromTicket } from '../../src/core/mirror/map'
import { upsertItem } from '../../src/core/mirror/store'
import { HOUR, id, mirrorHarness, o, readerOf, withTickets } from './mirror-harness'

const h = mirrorHarness('core_mirror_sync')
const { rows, newSource, sync, items, source, numbersOf, fresh, settle, later } = h

describe('first import', () => {
  it('spreads a large repository over runs of at most 50 items and marks the import complete', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    for (let i = 1; i <= 120; i++) await fake.tickets(repo).create({ title: `issue ${i}`, body: `body ${i}` })
    const sourceId = await newSource(repo)
    const readers = { [repo]: readerOf(fake) }

    await sync(readers)
    expect(await numbersOf(repo)).toHaveLength(50)
    expect((await source(sourceId))?.imported_at).toBeNull()

    await sync(readers)
    expect(await numbersOf(repo)).toHaveLength(100)

    await sync(readers)
    expect(await numbersOf(repo)).toHaveLength(120)
    expect((await source(sourceId))?.imported_at).toBeNull()

    await sync(readers)
    expect((await source(sourceId))?.imported_at).not.toBeNull()
    expect(await numbersOf(repo)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1))
  })

  it('stores what the forge says about an issue', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo', trusted: ['jo'], bots: ['robot'] })
    const input = { title: 'Crash', body: 'It crashes', labels: ['bug'], author: 'jo' }
    const ticket = await fake.tickets(repo).create(input)
    await fake.tickets(repo).claim(ticket.id, 'jo')
    await fake.tickets(repo).create({ title: 'Spam', author: 'robot' })
    await sync({ [repo]: readerOf(fake) })
    const [first, second] = await items(repo)
    expect(first).toMatchObject({
      kind: 'issue',
      title: 'Crash',
      body: 'It crashes',
      state: 'open',
      author: 'jo',
      author_trusted: true,
      author_is_bot: false,
      labels: ['bug'],
      assignees: ['jo'],
      product_id: h.ids.product,
      workspace_id: h.ids.workspace,
      head_sha: null,
      gone_at: null,
    })
    expect(second).toMatchObject({ author: 'robot', author_trusted: false, author_is_bot: true })
  })
})

describe('idempotence', () => {
  it('a second run of the same state changes nothing', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const ticket = await fake.tickets(repo).create({ title: 'a' })
    await fake.tickets(repo).comment(ticket.id, 'hello')
    const readers = { [repo]: readerOf(fake) }
    await settle(readers)
    const snapshot = async () => ({
      items: await items(repo),
      comments: await rows(sql`SELECT * FROM "mirror_comments" ORDER BY "id"`),
    })
    const before = await snapshot()
    later(60_000)
    await sync(readers)
    expect(await snapshot()).toEqual(before)
  })

  it('an upsert of the same row changes nothing but syncedAt', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const ticket = await fake.tickets(repo).create({ title: 'a', body: 'b' })
    const sourceId = await newSource(repo)
    const context = { workspace: h.ids.workspace, product: h.ids.product, source: sourceId, repo }
    const row = itemFromTicket(ticket)
    const first = await upsertItem(h.payload(), context, row, new Date('2026-11-19T10:00:00Z'))
    const [before] = await items(repo)
    const second = await upsertItem(h.payload(), context, row, new Date('2026-11-19T11:00:00Z'))
    const [after] = await items(repo)
    expect(second).toBe(first)
    expect(await items(repo)).toHaveLength(1)
    const { synced_at: syncedBefore, ...restBefore } = before ?? {}
    const { synced_at: syncedAfter, ...restAfter } = after ?? {}
    expect(restAfter).toEqual(restBefore)
    expect(new Date(String(syncedAfter)).getTime() - new Date(String(syncedBefore)).getTime()).toBe(HOUR)
  })
})

describe('failures and scope', () => {
  it('stores the error of a failing source, keeps its cursor and does not stop a healthy source', async () => {
    const [good, bad] = [fresh(), fresh()]
    const goodFake = new FakeBackend({ native: true, user: 'jo' })
    const badFake = new FakeBackend({ native: true, user: 'jo' })
    await goodFake.tickets(good).create({ title: 'ok' })
    await badFake.tickets(bad).create({ title: 'one' })
    await badFake.tickets(bad).create({ title: 'two' })
    const [goodId, badId] = [await newSource(good), await newSource(bad)]
    const broken = withTickets(readerOf(badFake), {
      get: (ticket) =>
        ticket === '2' ? Promise.reject(new Error('forge says 502')) : badFake.tickets(bad).get(ticket),
    })

    const result = await sync({ [good]: readerOf(goodFake), [bad]: broken })
    expect(result).toEqual({ synced: 1, failed: 1, paused: 0 })
    expect(await numbersOf(good)).toEqual([1])
    expect((await source(goodId))?.last_error).toBeNull()
    expect((await source(badId))?.last_error).toBe('forge says 502')
    expect((await source(badId))?.cursor).toBeNull()

    const both = await sync({ [good]: readerOf(goodFake), [bad]: readerOf(badFake) })
    expect(both).toEqual({ synced: 2, failed: 0, paused: 0 })
    expect((await source(badId))?.last_error).toBeNull()
    expect(await numbersOf(bad)).toEqual([1, 2])
  })

  it('records a missing reader as that source\'s error', async () => {
    const repo = fresh()
    const sourceId = await newSource(repo)
    expect((await sync({})).failed).toBe(1)
    expect((await source(sourceId))?.last_error).toBe(`no reader for ${repo}`)
  })

  it('skips the sources of an archived Workspace', async () => {
    const archived = id(
      await h.payload().create({ collection: 'workspaces', data: { name: 'old', slug: 'old' }, ...o }),
    )
    const archivedProduct = id(
      await h.payload().create({ collection: 'products', data: { name: 'x', slug: 'x', workspace: archived }, ...o }),
    )
    const repo = fresh()
    const archivedConnection = id(
      await h.payload().create({
        collection: 'connections',
        data: { name: 'gh', kind: 'github', workspace: archived },
        ...o,
      }),
    )
    const sourceId = id(
      await h.payload().create({
        collection: 'ticket_sources',
        data: { repo, product: archivedProduct, connection: archivedConnection, workspace: archived },
        ...o,
      }),
    )
    await rows(sql`UPDATE "workspaces" SET "archived_at" = now() WHERE "id" = ${archived}`)
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.tickets(repo).create({ title: 'a' })
    await sync({ [repo]: readerOf(fake) })
    expect(await numbersOf(repo)).toEqual([])
    expect((await source(sourceId))?.last_polled_at).toBeNull()
  })
})
