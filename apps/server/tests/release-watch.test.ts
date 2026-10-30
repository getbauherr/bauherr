import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

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
const reviewTicket = async (title: string, factory = false) => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title, labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = factory ? `bauherr/${issue.number}-x` : `feat-${issue.number}`
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

const setProduct = (data: Record<string, unknown>) => payload.update({ collection: 'products', id: product, data, ...o })

it('ignores a pull request URL outside the ticket source repo', async () => {
  const { t, pr } = await reviewTicket('foreign')
  fake.merge(repo, pr.number)
  await payload.update({ collection: 'runs', where: { ticket: { equals: t.id } }, data: { artifacts: { prUrl: `https://evil.example/acme/web/pull/${pr.number}` } }, ...o })
  expect(await release.watchRelease(payload)).toMatchObject({ released: 0 })
  expect((await reload(t.id as number)).stage).toBe('review')
})

it('evaluates only the latest run of a check name', async () => {
  await setProduct({ deployChecks: '' })
  const { pr, n } = await reviewTicket('rerun')
  const sha = fake.merge(repo, pr.number)
  await release.watchRelease(payload)
  fake.setChecks(repo, sha, [{ id: 1, name: 'ci', status: 'completed', conclusion: 'failure' }, { id: 2, name: 'ci', status: 'completed', conclusion: 'success' }])
  await release.watchRelease(payload)
  expect(await summaries(n)).toHaveLength(1)
})

it('webhook mode: POSTs once, retries after a non-2xx, confirms only 2 minutes after the request', async () => {
  await setProduct({ deployMode: 'webhook', deployWebhookUrl: 'https://hook.example/deploy', stagingUrl: 'https://staging.example' })
  const status = { hook: 500, staging: 200 }
  const fetchMock = vi.fn(async (url: string) => new Response(null, { status: url.includes('hook') ? status.hook : status.staging }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    const { t, pr, n } = await reviewTicket('hooked')
    fake.merge(repo, pr.number)
    const t0 = Date.now()
    await release.watchRelease(payload, t0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await reload(t.id as number)).toMatchObject({ stage: 'release', deployRequestedAt: null })
    status.hook = 200
    await release.watchRelease(payload, t0 + 1000)
    await release.watchRelease(payload, t0 + 2000)
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('hook'))).toHaveLength(2)
    await release.watchRelease(payload, t0 + release.WEBHOOK_SETTLE_MS - 1000)
    expect(await summaries(n)).toHaveLength(0)
    await release.watchRelease(payload, t0 + 1000 + release.WEBHOOK_SETTLE_MS)
    expect(await summaries(n)).toHaveLength(1)
  } finally {
    vi.unstubAllGlobals()
    await setProduct({ deployMode: 'observe-ci', deployWebhookUrl: null })
  }
})

it('still times out when the probe throws', async () => {
  const { t, pr } = await reviewTicket('probe')
  fake.merge(repo, pr.number)
  const t0 = Date.now()
  await release.watchRelease(payload, t0)
  const spy = vi.spyOn(fake.forge, 'listChecks').mockRejectedValue(new Error('boom'))
  try {
    await release.watchRelease(payload, t0 + release.STAGING_TIMEOUT_MS + 1000)
  } finally {
    spy.mockRestore()
  }
  expect((await reload(t.id as number)).releaseState).toBe('timed_out')
})

it('notes a closed-unmerged MR once and leaves the Ticket in review', async () => {
  const { t, pr, n } = await reviewTicket('closed')
  fake.close(repo, pr.number)
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  const notes = (await fake.tickets(repo).listComments(n)).filter((c) => c.body.includes('closed without merge'))
  expect(notes).toHaveLength(1)
  expect((await reload(t.id as number)).stage).toBe('review')
})

const reopenedNotes = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith(release.REOPENED_MARKER))

it('reopens a Ticket closed by its merged factory MR, comments once, then posts the staging summary', async () => {
  await setProduct({ deployChecks: '' })
  const { t, pr, n } = await reviewTicket('closed by merge', true)
  const sha = fake.merge(repo, pr.number)
  fake.setChecks(repo, sha, green)
  await fake.tickets(repo).close(n, 'completed')
  await payload.update({ collection: 'tickets', id: t.id, data: { state: 'closed' }, ...o })
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await reopenedNotes(n)).toHaveLength(1)
  expect((await fake.tickets(repo).get(n)).state).toBe('open')
  expect(await reload(t.id as number)).toMatchObject({ state: 'open', stage: 'release' })
  expect(await summaries(n)).toHaveLength(1)
})

it('leaves a Ticket closed by a human without a merged factory MR closed', async () => {
  const { t, n } = await reviewTicket('closed by hand', true)
  await fake.tickets(repo).close(n, 'not_planned')
  await payload.update({ collection: 'tickets', id: t.id, data: { state: 'closed' }, ...o })
  await release.watchRelease(payload)
  expect(await reopenedNotes(n)).toHaveLength(0)
  expect((await fake.tickets(repo).get(n)).state).toBe('closed')
  expect((await reload(t.id as number)).state).toBe('closed')
})

it('leaves an accepted Ticket closed', async () => {
  const { t, pr, n } = await reviewTicket('accepted', true)
  fake.merge(repo, pr.number)
  await fake.tickets(repo).addLabels(n, [release.APPROVED_STAGING])
  await fake.tickets(repo).close(n, 'completed')
  await payload.update({ collection: 'tickets', id: t.id, data: { state: 'closed', stage: 'release', releaseState: 'on_staging' }, ...o })
  await release.watchRelease(payload)
  expect(await reopenedNotes(n)).toHaveLength(0)
  expect((await fake.tickets(repo).get(n)).state).toBe('closed')
})
