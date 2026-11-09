import type { FakeBackend } from '@bauherr/adapters'
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
  for (const [slug, releaseMode] of [['ship', 'factory'], ['bad', 'factory'], ['retry', 'factory'], ['man', 'manual']] as const) {
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
  return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'closed', stage: 'done', mergeSha: sha, labels, product: products[slug], workspace: ws }, ...o })) as Record<string, any>
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
