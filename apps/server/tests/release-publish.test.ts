import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { buildStagingSummary } from '../src/lib/summary'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let user: Record<string, any>
let release: typeof import('../src/lib/release')
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const
const products: Record<string, number> = {}

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('release_publish_106')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.GATEWAY_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', gatewayKey: (await import('../src/lib/secrets')).encrypt('k') }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  for (const [slug, releaseMode] of [['fac', 'factory'], ['notes', 'notes-only'], ['late', 'notes-only'], ['down', 'factory'], ['dt', 'factory'], ['ct', 'notes-only'], ['bad', 'factory']] as const) {
    products[slug] = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws, productionGate: true, productionChecks: 'deploy-prod', releaseMode }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo: `acme/${slug}`, product: products[slug], connection, workspace: ws }, ...o })
  }
})

afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** A Ticket accepted on staging (with a staging summary) and approved for production. */
const approved = async (slug: string, title: string, sha: string, labels: string[] = []) => {
  const repo = `acme/${slug}`
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title, labels: ['bauherr:stage:release', ...labels] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'release', releaseState: 'on_staging', mergeSha: sha, product: products[slug], workspace: ws }, ...o })
  await ts.comment(String(issue.number), buildStagingSummary({ ticket: { number: issue.number, title, url: issue.url }, plan: `## Goal\n- ${title} works`, worklog: null, mrs: [{ number: 1, url: `https://fake/${repo}/pull/1`, title, body: '' }], evidence: null, stagingUrl: null, mergeSha: sha }))
  await actions.acceptStaging(payload, user, { ticket: t.id as number })
  await actions.approveProduction(payload, user, { ticket: t.id as number })
  return { id: t.id as number, n: String(issue.number), url: issue.url }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const body = (slug: string) => fake.listReleases(`acme/${slug}`).at(-1)!.body

it('factory mode: one release with a computed tag, grouped notes, a CHANGELOG MR and releaseUrl on every Ticket; a retry creates nothing more', async () => {
  fake.commit('acme/fac', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  fake.setCommits('acme/fac', [{ sha: 'sha-b', message: 'fix: totals' }, { sha: 'sha-a', message: 'feat: export' }])
  const a = await approved('fac', 'CSV export', 'sha-a')
  const b = await approved('fac', 'Totals wrong', 'sha-b', ['bug'])

  expect(await release.publishRelease(payload, products.fac!)).toMatchObject({ state: 'published' })
  const releases = fake.listReleases('acme/fac')
  expect(releases).toMatchObject([{ tag: 'v0.1.0', sha: 'sha-b' }])
  expect(body('fac')).toMatch(/### Features\n- CSV export \(\[#1\]\(.+\), \[#1 CSV export\]\(.+\)\)\n {2}- CSV export works\n\n### Fixes\n- Totals wrong/)
  expect(body('fac')).toContain(release.releaseMarker('sha-b'))
  const prs = await fake.forge.listPullRequests('acme/fac', 'all')
  expect(prs).toMatchObject([{ head: 'bauherr/release-v0.1.0', base: 'main' }])
  expect((await fake.forge.getFile('acme/fac', 'CHANGELOG.md', 'bauherr/release-v0.1.0')).content).toMatch(/## Unreleased\n\n## 0\.1\.0 - \d{4}-\d\d-\d\d\n\n### Features/)
  for (const t of [a, b]) {
    expect((await reload(t.id)).releaseUrl).toBe(releases[0]!.url)
    expect((await fake.tickets('acme/fac').listComments(t.n)).at(-1)!.body).toContain(`Released in [v0.1.0](${releases[0]!.url})`)
  }

  expect(await release.publishRelease(payload, products.fac!)).toEqual({ state: 'none' })
  await payload.update({ collection: 'tickets', id: b.id, data: { releasePublishedAt: null }, ...o })
  expect(await release.publishRelease(payload, products.fac!)).toMatchObject({ state: 'published' })
  expect(fake.listReleases('acme/fac')).toHaveLength(1)
  expect(await fake.forge.listPullRequests('acme/fac', 'all')).toHaveLength(1)
})

it('notes-only with an existing release: its body gets the notes, no new tag', async () => {
  fake.addRelease('acme/notes', { tag: 'v1.2.3', sha: 'sha-n', body: 'semantic-release notes' })
  const t = await approved('notes', 'Dark mode', 'sha-n')
  expect(await release.publishRelease(payload, products.notes!)).toMatchObject({ state: 'published' })
  expect(fake.listReleases('acme/notes')).toHaveLength(1)
  expect(body('notes')).toMatch(/^semantic-release notes\n\n## What's new\n\n### Features\n- Dark mode/)
  expect((await reload(t.id)).releaseUrl).toBe(fake.listReleases('acme/notes')[0]!.url)
  expect(await fake.forge.listPullRequests('acme/notes', 'all')).toHaveLength(0)
})

it('notes-only without a release waits, then posts the notes on the Tickets after 6 hours and creates nothing', async () => {
  const t = await approved('late', 'Search', 'sha-l')
  expect(await release.publishRelease(payload, products.late!)).toEqual({ state: 'waiting' })
  expect(await release.publishRelease(payload, products.late!, Date.now() + release.RELEASE_WAIT_MS + 60_000)).toEqual({ state: 'fallback' })
  const last = (await fake.tickets('acme/late').listComments(t.n)).at(-1)!.body
  expect(last).toContain('no release found for `sha-l`')
  expect(last).toContain('### Features')
  expect(fake.listReleases('acme/late')).toHaveLength(0)
  expect(await reload(t.id)).toMatchObject({ releaseUrl: null })
  expect(await release.publishRelease(payload, products.late!)).toEqual({ state: 'none' })
})

it('publishes the deterministic notes when the gateway is down', async () => {
  process.env.GATEWAY_URL = 'http://gateway.test'
  const down = vi.fn(async () => new Response('busy', { status: 503 }))
  vi.stubGlobal('fetch', down)
  fake.commit('acme/down', 'main', 'CHANGELOG.md', '## Unreleased\n')
  await approved('down', 'Billing', 'sha-d')
  expect(await release.publishRelease(payload, products.down!)).toMatchObject({ state: 'published' })
  delete process.env.GATEWAY_URL
  expect(down).toHaveBeenCalledOnce()
  expect(body('down')).toContain('### Features\n- Billing ([#1]')
})

it('tags the newest merge commit by date, not the newest approved sha', async () => {
  fake.commit('acme/dt', 'main', 'CHANGELOG.md', '## Unreleased\n')
  fake.setCommitDate('acme/dt', 'sha-x', '2026-01-02T00:00:00Z')
  fake.setCommitDate('acme/dt', 'sha-y', '2026-01-01T00:00:00Z')
  await approved('dt', 'First', 'sha-x')
  await approved('dt', 'Second', 'sha-y')
  expect(await release.publishRelease(payload, products.dt!)).toMatchObject({ state: 'published' })
  expect(fake.listReleases('acme/dt')).toMatchObject([{ sha: 'sha-x' }])
})

it('notes-only matches the release whose tag commit contains the merge sha', async () => {
  fake.addRelease('acme/ct', { tag: 'v3.0.0', sha: 'chore-release', body: 'notes', contains: ['sha-c'] })
  const t = await approved('ct', 'Contained', 'sha-c')
  expect(await release.publishRelease(payload, products.ct!)).toMatchObject({ state: 'published' })
  expect(fake.listReleases('acme/ct')).toHaveLength(1)
  expect(body('ct')).toContain('### Features\n- Contained')
  expect((await reload(t.id)).releaseUrl).toBe(fake.listReleases('acme/ct')[0]!.url)
})

it('a persistent publish failure backs off for an hour, caches the notes, and gives up after 3 with a Comment', async () => {
  const t = await approved('bad', 'Broken', 'sha-bad')
  const at = Date.now()
  await release.publishReleases(payload, at)
  expect(await reload(t.id)).toMatchObject({ releaseAttempts: 1, releaseError: expect.stringContaining('CHANGELOG.md') })
  expect((await reload(t.id)).releaseNotes).toContain('Broken')
  await release.publishReleases(payload, at + 30 * 60_000)
  expect((await reload(t.id)).releaseAttempts).toBe(1)
  await release.publishReleases(payload, at + release.RELEASE_RETRY_MS + 1)
  expect((await reload(t.id)).releaseAttempts).toBe(2)
  await release.publishReleases(payload, at + 2 * release.RELEASE_RETRY_MS + 2)
  expect((await reload(t.id)).releaseAttempts).toBe(3)
  expect((await fake.tickets('acme/bad').listComments(t.n)).at(-1)!.body).toContain('given up')
  await release.publishReleases(payload, at + 9 * release.RELEASE_RETRY_MS)
  expect((await reload(t.id)).releaseAttempts).toBe(3)
})
