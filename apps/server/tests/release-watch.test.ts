import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_release_watch WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_release_watch')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_release_watch')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

/** A review Ticket (forge issue + Payload row) whose build Run opened an MR. */
const reviewTicket = async (title: string) => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title, labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = `feat-${issue.number}`
  await fake.forge.createBranch(repo, branch)
  const pr = await fake.forge.openPullRequest(repo, { title, head: branch, base: 'main' })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  return { t, pr, n: String(issue.number) }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const summaries = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:staging-summary -->'))
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]

it('moves a merged Ticket to release, then posts the summary once when checks are green', async () => {
  const { t, pr, n } = await reviewTicket('green')
  expect(await release.watchRelease(payload)).toMatchObject({ released: 0 })
  expect((await reload(t.id as number)).stage).toBe('review')

  const sha = fake.merge(repo, pr.number)
  expect(await release.watchRelease(payload)).toMatchObject({ released: 1 })
  expect(await reload(t.id as number)).toMatchObject({ stage: 'release', mergeSha: sha, releaseState: 'waiting' })
  expect((await fake.tickets(repo).get(n)).labels).toContain('bauherr:stage:release')

  await release.watchRelease(payload)
  expect(await summaries(n)).toHaveLength(0)

  fake.setChecks(repo, sha, [{ name: 'ci', status: 'in_progress', conclusion: null }])
  await release.watchRelease(payload)
  expect(await summaries(n)).toHaveLength(0)

  fake.setChecks(repo, sha, green)
  expect(await release.watchRelease(payload)).toMatchObject({ confirmed: 1 })
  await release.watchRelease(payload)
  expect(await summaries(n)).toHaveLength(1)
  expect((await reload(t.id as number)).releaseState).toBe('on_staging')
})

it('needs a human after 60 minutes without confirmation', async () => {
  const { t, pr, n } = await reviewTicket('late')
  fake.merge(repo, pr.number)
  const t0 = Date.now()
  await release.watchRelease(payload, t0)
  await release.watchRelease(payload, t0 + release.STAGING_TIMEOUT_MS - 1000)
  expect((await reload(t.id as number)).releaseState).toBe('waiting')
  expect(await release.watchRelease(payload, t0 + release.STAGING_TIMEOUT_MS + 1000)).toMatchObject({ timedOut: 1 })
  expect((await reload(t.id as number)).releaseState).toBe('timed_out')
  expect((await fake.tickets(repo).listComments(n)).some((c) => c.body.includes('staging not confirmed'))).toBe(true)
  expect(await summaries(n)).toHaveLength(0)
})

it('honours deployChecks: a named check that has not reported keeps waiting', async () => {
  await payload.update({ collection: 'products', id: product, data: { deployChecks: 'deploy' }, ...o })
  const { t, pr, n } = await reviewTicket('named')
  const sha = fake.merge(repo, pr.number)
  fake.setChecks(repo, sha, green)
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await summaries(n)).toHaveLength(0)
  fake.setChecks(repo, sha, [...green, { name: 'deploy', status: 'completed', conclusion: 'success' }])
  await release.watchRelease(payload)
  expect(await summaries(n)).toHaveLength(1)
  expect((await reload(t.id as number)).releaseState).toBe('on_staging')
})
