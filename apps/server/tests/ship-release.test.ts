import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let user: Record<string, any>
let ship: typeof import('../src/lib/ship-release')
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
const products: Record<string, number> = {}

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('ship_release_404')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ship = await import('../src/lib/ship-release')
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', gatewayKey: (await import('../src/lib/secrets')).encrypt('k') }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  for (const [slug, releaseMode] of [['ship', 'factory'], ['bad', 'factory'], ['retry', 'factory'], ['stale', 'factory'], ['man', 'manual'], ['page', 'manual'], ['old', 'manual'], ['board', 'manual'], ['burst', 'manual'], ['backfill', 'manual'], ['dates', 'manual'], ['dates-ship', 'manual']] as const) {
    products[slug] = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws, releaseMode }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo: `acme/${slug}`, product: products[slug], connection, workspace: ws }, ...o })
  }
})

afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** A done Ticket merged as `sha` (committed `day` of Nov 2026). */
const done = async (slug: string, title: string, sha: string, day: number, labels: string[] = []) => {
  const repo = `acme/${slug}`
  const issue = await fake.tickets(repo).create({ title, labels })
  fake.setCommitDate(repo, sha, `2026-11-0${day}T10:00:00Z`)
  return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'closed', stage: 'done', mergeSha: sha, releaseAt: `2026-11-0${day}T10:00:00Z`, labels, product: products[slug], workspace: ws }, ...o })) as Record<string, any>
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const touches = async (slug: string, tag: string) => (await payload.find({ collection: 'human_touches', where: { and: [{ kind: { equals: 'ship:release' } }, { status: { equals: tag } }, { repo: { equals: `acme/${slug}` } }] }, ...o })).docs

it('proposes the version from the Ticket mix; an rc line keeps counting', () => {
  const t = (...labels: string[]) => ({ labels })
  expect(ship.proposeVersion(null, [t()])).toBe('0.1.0')
  expect(ship.proposeVersion('v1.2.3', [t('bug'), t()])).toBe('1.2.4')
  expect(ship.proposeVersion('v1.2.3', [t('bug'), t('type:feature')])).toBe('1.3.0')
  expect(ship.proposeVersion('v1.2.3', [t('type:feature'), t('breaking')])).toBe('2.0.0')
  expect(ship.proposeVersion('v1.3.0-rc.2', [t('breaking')])).toBe('1.3.0-rc.3')
})

it('lists done Tickets without a release', async () => {
  const a = await done('ship', 'Export', 'sha-a', 1, ['type:feature'])
  await payload.update({ collection: 'tickets', id: a.id, data: { releasedIn: 'v0.0.1' }, ...o })
  const b = await done('ship', 'Totals', 'sha-b', 2)
  expect((await ship.waitingTickets(payload, products.ship!)).map((t) => t.id)).toEqual([b.id])
})

it('does not list or remind about Tickets released before the page: release recorded, or merge in the latest release', async () => {
  await payload.update({ collection: 'products', id: products.old!, data: { releaseReminderDays: 1 }, ...o })
  const a = await done('old', 'Notes only', 'sha-o1', 1)
  await payload.update({ collection: 'tickets', id: a.id, data: { releasePublishedAt: '2026-10-01T00:00:00Z', releaseAt: '2026-10-01T00:00:00Z' }, ...o })
  await done('old', 'In the rc', 'sha-o2', 2)
  await done('old', 'Released url', 'sha-o3', 3).then((t) => payload.update({ collection: 'tickets', id: t.id, data: { releaseUrl: 'https://x/r', releaseAt: '2026-10-01T00:00:00Z' }, ...o }))
  const fresh = await done('old', 'Fresh', 'sha-o4', 4)
  fake.setAncestors('acme/old', 'sha-o2', ['sha-o1'])
  await fake.forge.createRelease('acme/old', { tag: 'v0.1.0-rc.1', sha: 'sha-o2', name: 'v0.1.0-rc.1', body: 'x', prerelease: true })
  await ship.releaseDraft(payload, products.old!)
  expect((await ship.waitingTickets(payload, products.old!)).map((t) => t.id)).toEqual([fresh.id])
  await payload.update({ collection: 'tickets', id: fresh.id, data: { releasedIn: 'v0.2.0' }, ...o })
  expect((await ship.releaseReminders(payload, ws)).find((r) => r.product.id === products.old)).toBeUndefined()
})

it('offers the bumps of the last release as version choices', () => {
  expect(ship.versionChoices(null)).toEqual(['0.1.0'])
  expect(ship.versionChoices('v1.2.3')).toEqual(['1.2.4', '1.3.0', '2.0.0'])
  expect(ship.versionChoices('v1.3.0-rc.2')).toEqual(['1.3.0-rc.3', '1.3.1', '1.4.0', '2.0.0'])
})

it('ships: tag on the newest merge, release, comments, releasedIn, CHANGELOG MR and one ship:release touch', async () => {
  fake.commit('acme/ship', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const tickets = await ship.waitingTickets(payload, products.ship!)
  const c = await done('ship', 'Search', 'sha-c', 3, ['type:feature'])
  tickets.push(c)
  fake.setAncestors('acme/ship', 'sha-c', ['sha-b'])
  const notes = await ship.renderNotes(fake.tickets('acme/ship'), tickets)
  const version = ship.proposeVersion(null, tickets)
  const res = await ship.shipRelease(payload, user, { product: products.ship!, tickets, version, notes })
  expect(res.tag).toBe('v0.1.0')
  expect(fake.listReleases('acme/ship')).toMatchObject([{ tag: 'v0.1.0', sha: 'sha-c' }])
  expect(fake.listReleases('acme/ship')[0]!.body).toContain('Search')
  for (const t of tickets) {
    expect(await reload(t.id)).toMatchObject({ releasedIn: 'v0.1.0' })
    expect((await fake.tickets('acme/ship').listComments(String(t.number))).at(-1)!.body).toContain(`Released in [v0.1.0](${res.url})`)
  }
  expect(await fake.forge.listPullRequests('acme/ship', 'all')).toMatchObject([{ head: 'bauherr/release-v0.1.0' }])
  expect(await touches('ship', 'v0.1.0')).toMatchObject([{ actor: 'a@x.io' }])
  expect(await ship.waitingTickets(payload, products.ship!)).toEqual([])
})

it('refuses when a merge is not an ancestor of the newest one and names the Ticket; nothing is created', async () => {
  const a = await done('bad', 'Old', 'sha-1', 1)
  const b = await done('bad', 'Diverged', 'sha-2', 2)
  const c = await done('bad', 'Newest', 'sha-3', 3)
  fake.setAncestors('acme/bad', 'sha-3', ['sha-1'])
  await expect(ship.shipRelease(payload, user, { product: products.bad!, tickets: [a, b, c], version: '0.1.0', notes: 'n' })).rejects.toThrow(`Ticket #${b.number} (sha-2) is not an ancestor`)
  expect(fake.listReleases('acme/bad')).toEqual([])
  expect(await touches('bad', 'v0.1.0')).toEqual([])
})

it('a retry after a forge error creates no second tag, release, comment, MR or touch', async () => {
  fake.commit('acme/retry', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const a = await done('retry', 'One', 'sha-r1', 1)
  const b = await done('retry', 'Two', 'sha-r2', 2)
  fake.setAncestors('acme/retry', 'sha-r2', ['sha-r1'])
  const args = { product: products.retry!, tickets: [a, b], version: '0.1.0', notes: 'n' }
  const comment = vi.spyOn(fake.tickets('acme/retry'), 'comment')
  comment.mockImplementationOnce(async () => ({ id: 'x', author: 'x', body: '', createdAt: '' })).mockRejectedValueOnce(new Error('forge down'))
  await expect(ship.shipRelease(payload, user, args)).rejects.toThrow('forge down')
  expect(fake.listReleases('acme/retry')).toHaveLength(1)
  const waiting = await ship.waitingTickets(payload, products.retry!)
  await ship.shipRelease(payload, user, { ...args, tickets: [a, b].map((t) => waiting.find((w) => w.id === t.id) ?? t) })
  await ship.shipRelease(payload, user, args)
  expect(fake.listReleases('acme/retry')).toHaveLength(1)
  expect(await fake.forge.listTags('acme/retry')).toEqual(['v0.1.0'])
  expect(await fake.forge.listPullRequests('acme/retry', 'all')).toHaveLength(1)
  expect(await touches('retry', 'v0.1.0')).toHaveLength(1)
  for (const t of [a, b]) expect(await reload(t.id)).toMatchObject({ releasedIn: 'v0.1.0' })
  expect((await fake.tickets('acme/retry').listComments(String(b.number))).filter((c) => c.body.includes('Released in'))).toHaveLength(1)
})

it('manual mode never tags automatically', async () => {
  await payload.update({ collection: 'products', id: products.man!, data: { releaseMode: 'manual' }, ...o })
  const t = await done('man', 'Waiting', 'sha-m', 1)
  await payload.update({ collection: 'tickets', id: t.id, data: { productionApprovedSha: 'sha-m', productionState: 'deployed' }, ...o })
  expect(await release.publishRelease(payload, products.man!)).toEqual({ state: 'none' })
  expect(fake.listReleases('acme/man')).toEqual([])
  expect(await fake.forge.listTags('acme/man')).toEqual([])
})

it('a second ship from stale Ticket docs changes no releasedAt, touch, release or comment', async () => {
  fake.commit('acme/stale', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const a = await done('stale', 'Alpha', 'sha-s1', 1)
  const b = await done('stale', 'Beta', 'sha-s2', 2)
  fake.setAncestors('acme/stale', 'sha-s2', ['sha-s1'])
  const args = { product: products.stale!, tickets: [a, b], version: '0.1.0', notes: 'n' }
  await ship.shipRelease(payload, user, args)
  const releasedAt = (await reload(a.id)).releasedAt
  await new Promise((r) => setTimeout(r, 5))
  await ship.shipRelease(payload, user, args)
  expect(await reload(a.id)).toMatchObject({ releasedIn: 'v0.1.0', releasedAt })
  expect(await touches('stale', 'v0.1.0')).toHaveLength(1)
  expect(fake.listReleases('acme/stale')).toHaveLength(1)
  expect((await fake.tickets('acme/stale').listComments(String(a.number))).filter((c) => c.body.includes('Released in'))).toHaveLength(1)
})

it('a touch a concurrent ship already wrote is not written twice', async () => {
  const c = await done('stale', 'Gamma', 'sha-s3', 3)
  const d = await done('stale', 'Delta', 'sha-s4', 4)
  fake.setAncestors('acme/stale', 'sha-s4', ['sha-s3'])
  await payload.db.drizzle.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "human_touches_ship_release_per_tag" ON "human_touches" ("repo", "status") WHERE "kind" = 'ship:release'`)
  await payload.create({ collection: 'human_touches', data: { kind: 'ship:release', ticket: c.id, workspace: ws, actor: 'other', at: new Date().toISOString(), repo: 'acme/stale', status: 'v0.2.0' }, ...o })
  const find = payload.find.bind(payload)
  const spy = vi.spyOn(payload, 'find').mockImplementation((a: { collection: string }) => (a.collection === 'human_touches' ? Promise.resolve({ totalDocs: 0, docs: [] }) : find(a as never)) as never)
  try {
    await ship.shipRelease(payload, user, { product: products.stale!, tickets: [c, d], version: '0.2.0', notes: 'n' })
  } finally {
    spy.mockRestore()
  }
  expect(await touches('stale', 'v0.2.0')).toHaveLength(1)
})

it('reminds only a manual Product whose oldest waiting Ticket is older than releaseReminderDays', () => {
  const day = 86_400_000
  const now = Date.parse('2026-11-20T00:00:00Z')
  const waiting = [{ releaseAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z' }, { updatedAt: '2026-11-18T00:00:00Z' }]
  expect(ship.releaseReminder({ releaseMode: 'manual', releaseReminderDays: 7 }, waiting, now)).toEqual({ count: 2, days: 10 })
  expect(ship.releaseReminder({ releaseMode: 'manual' }, waiting, now)).toMatchObject({ days: 10 })
  expect(ship.releaseReminder({ releaseMode: 'manual', releaseReminderDays: 10 }, waiting, now)).toBeNull()
  expect(ship.releaseReminder({ releaseMode: 'factory', releaseReminderDays: 1 }, waiting, now)).toBeNull()
  expect(ship.releaseReminder({ releaseMode: 'manual' }, [], now + 30 * day)).toBeNull()
})

it('shipSelected is admin only, stays in the Workspace and ships exactly the selected Tickets', async () => {
  fake.commit('acme/page', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const a = await done('page', 'First', 'sha-p1', 1)
  const b = await done('page', 'Second', 'sha-p2', 2)
  const c = await done('page', 'Third', 'sha-p3', 3)
  fake.setAncestors('acme/page', 'sha-p2', ['sha-p1'])
  const member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr' }, ...o })
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  const args = { workspaceId: ws, product: products.page!, ids: [a.id, b.id], version: '0.1.0', notes: 'n' }
  await expect(ship.shipSelected(payload, member, args)).rejects.toThrow('Only an Admin')
  await expect(ship.shipSelected(payload, user, { ...args, workspaceId: other })).rejects.toThrow()
  await expect(ship.shipSelected(payload, user, { ...args, version: 'soon' })).rejects.toThrow('The version must look like')
  expect(fake.listReleases('acme/page')).toEqual([])
  await ship.shipSelected(payload, user, args)
  expect(fake.listReleases('acme/page')).toMatchObject([{ tag: 'v0.1.0', sha: 'sha-p2' }])
  expect((await reload(c.id)).releasedIn).toBeFalsy()
  await expect(ship.shipSelected(payload, user, { ...args, version: '0.1.1' })).rejects.toThrow('no longer waiting')
  const draft = await ship.releaseDraft(payload, products.page!)
  expect(draft).toMatchObject({ version: '0.1.1', past: [{ tag: 'v0.1.0' }] })
  expect(draft.waiting.map((t) => t.id)).toEqual([c.id])
})

/** Counts every call into the fake forge (forge methods and ticket-source lookups). */
const countForgeCalls = () => {
  const calls = { n: 0 }
  for (const k of Object.keys(fake.forge) as (keyof typeof fake.forge)[]) {
    const f = fake.forge[k] as unknown
    if (typeof f === 'function') (vi.spyOn(fake.forge, k as never) as any).mockImplementation(((...a: unknown[]) => { calls.n++; return (f as (...x: unknown[]) => unknown)(...a) }) as never)
  }
  const tickets = fake.tickets.bind(fake)
  vi.spyOn(fake, 'tickets').mockImplementation((repo) => { calls.n++; return tickets(repo) })
  return calls
}

it('10 Board loads with a manual Product make 0 forge calls and still remind', async () => {
  await payload.update({ collection: 'products', id: products.board!, data: { releaseReminderDays: 1, lastReleaseAt: '2026-10-01T00:00:00Z', lastReleaseTag: 'v0.1.0' }, ...o })
  await done('board', 'Waiting one', 'sha-b1', 1)
  await done('board', 'Waiting two', 'sha-b2', 2)
  const calls = countForgeCalls()
  for (let i = 0; i < 10; i++) expect((await ship.releaseReminders(payload, ws)).find((r) => r.product.id === products.board)).toMatchObject({ count: 2 })
  expect(calls.n).toBe(0)
})

it('a done Ticket without a merge commit is not waiting', async () => {
  const t = await done('board', 'Closed by hand', 'sha-x', 3)
  await payload.update({ collection: 'tickets', id: t.id, data: { mergeSha: null }, ...o })
  expect((await ship.waitingTickets(payload, products.board!)).map((w) => w.id)).not.toContain(t.id)
})

it('ship stores lastRelease*; the Releases page backfills it once and asks ancestry at most 4 at a time', async () => {
  const early = await done('burst', 'Early', 'sha-u0', 1)
  fake.setAncestors('acme/burst', 'sha-u0', [])
  await fake.forge.createRelease('acme/burst', { tag: 'v0.1.0', sha: 'sha-u0', name: 'v0.1.0', body: 'x' })
  const wanted = []
  for (let i = 1; i <= 10; i++) wanted.push(await done('burst', `Burst ${i}`, `sha-u${i}`, 2 + (i % 5)))
  expect((await payload.findByID({ collection: 'products', id: products.burst!, ...o })).lastReleaseTag).toBeFalsy()
  let active = 0
  let max = 0
  const ask = fake.forge.isAncestor
  vi.spyOn(fake.forge as { isAncestor: typeof ask }, 'isAncestor').mockImplementation(async (...a: Parameters<typeof ask>) => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); active--; return ask(...a) })
  const draft = await ship.releaseDraft(payload, products.burst!)
  expect(max).toBeLessThanOrEqual(4)
  expect(max).toBeGreaterThan(1)
  expect(await payload.findByID({ collection: 'products', id: products.burst!, ...o })).toMatchObject({ lastReleaseTag: 'v0.1.0', lastReleaseSha: 'sha-u0' })
  expect(draft.waiting.map((t) => t.id)).toEqual(wanted.map((t) => t.id))
  expect(draft.waiting.map((t) => t.id)).not.toContain(early.id)
  const lastDay = (await payload.findByID({ collection: 'products', id: products.burst!, ...o })).lastReleaseAt
  const calls = countForgeCalls()
  await ship.releaseDraft(payload, products.burst!, [wanted[0]!.id], false)
  expect(calls.n).toBeLessThanOrEqual(1)
  expect(lastDay).toBeTruthy()
})

it('a Ticket in the latest release counts as waiting until the Releases page records it, and never again after', async () => {
  const old = await done('backfill', 'Before the feature', 'sha-bf1', 1)
  await payload.update({ collection: 'tickets', id: old.id, data: { releaseAt: null }, ...o })
  const fresh = await done('backfill', 'Fresh', 'sha-bf2', 2)
  fake.setAncestors('acme/backfill', 'sha-bf3', ['sha-bf1'])
  await fake.forge.createRelease('acme/backfill', { tag: 'v0.1.0', sha: 'sha-bf3', name: 'v0.1.0', body: 'x' })
  expect((await ship.waitingTickets(payload, products.backfill!)).map((t) => t.id)).toEqual([old.id, fresh.id])
  await ship.releaseDraft(payload, products.backfill!)
  expect(await reload(old.id)).toMatchObject({ releasedIn: 'v0.1.0' })
  for (let i = 0; i < 3; i++) expect((await ship.waitingTickets(payload, products.backfill!)).map((t) => t.id)).toEqual([fresh.id])
  await ship.releaseDraft(payload, products.backfill!)
  expect((await ship.waitingTickets(payload, products.backfill!)).map((t) => t.id)).toEqual([fresh.id])
})

it('the backfill and a ship store the same lastReleaseAt: the commit date of the release head', async () => {
  const early = await done('dates', 'Contained', 'sha-dt1', 1)
  fake.setCommitDate('acme/dates', 'sha-dt2', '2026-11-06T08:00:00Z')
  fake.setAncestors('acme/dates', 'sha-dt2', ['sha-dt1'])
  await fake.forge.createRelease('acme/dates', { tag: 'v0.1.0', sha: 'sha-dt2', name: 'v0.1.0', body: 'x' })
  await ship.releaseDraft(payload, products.dates!)
  const backfilled = (await payload.findByID({ collection: 'products', id: products.dates!, ...o })).lastReleaseAt
  expect(backfilled).toBe('2026-11-06T08:00:00.000Z')
  expect(await reload(early.id)).toMatchObject({ releasedIn: 'v0.1.0' })
  fake.commit('acme/dates-ship', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const head = await done('dates-ship', 'Head', 'sha-dt2', 6)
  fake.setCommitDate('acme/dates-ship', 'sha-dt2', '2026-11-06T08:00:00Z')
  await ship.shipRelease(payload, user, { product: products['dates-ship']!, tickets: [head], version: '0.1.0', notes: 'n' })
  expect((await payload.findByID({ collection: 'products', id: products['dates-ship']!, ...o })).lastReleaseAt).toBe(backfilled)
})

it('shipRelease records the release on the Product so the Board needs no forge', async () => {
  fake.commit('acme/board', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const a = await done('board', 'Shipped', 'sha-b9', 5)
  await ship.shipRelease(payload, user, { product: products.board!, tickets: [a], version: '0.2.0', notes: 'n' })
  expect(await payload.findByID({ collection: 'products', id: products.board!, ...o })).toMatchObject({ lastReleaseTag: 'v0.2.0', lastReleaseSha: 'sha-b9' })
  expect((await payload.findByID({ collection: 'products', id: products.board!, ...o })).lastReleaseAt).toContain('2026-11-05')
})
