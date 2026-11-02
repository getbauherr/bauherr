import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let release: typeof import('../src/lib/release')
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const ok = (name = 'deploy-prod') => [{ name, status: 'completed', conclusion: 'success' }]

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_production_gate_84 WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_production_gate_84')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_production_gate_84')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, productionGate: true, productionChecks: 'deploy-prod' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

/** A Ticket accepted on staging with the production gate: stage release, awaiting approval. */
const accepted = async (title: string) => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title, labels: ['bauherr:stage:release'] })
  const mergeSha = `sha-${issue.number}`
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'release', releaseState: 'on_staging', mergeSha, product, workspace: ws }, ...o })
  await actions.acceptStaging(payload, user, { ticket: t.id as number })
  return { id: t.id as number, n: String(issue.number), sha: mergeSha }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const comments = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith(release.PRODUCTION_MARKER))
const labels = async (n: string) => (await fake.tickets(repo).get(n)).labels

it('changes nothing in production before an approval', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: 'https://hook.example/prod' }, ...o })
  try {
    const { id, n, sha } = await accepted('gated')
    fake.setChecks(repo, sha, ok())
    await release.watchProduction(payload)
    await release.watchProduction(payload, Date.now() + 10 * 60_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await reload(id)).toMatchObject({ stage: 'release', state: 'open', productionState: 'awaiting_approval' })
    expect(await labels(n)).not.toContain('bauherr:approved:production')
    expect(await comments(n)).toHaveLength(0)
  } finally {
    vi.unstubAllGlobals()
    await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: null }, ...o })
  }
})

it('a human label on the forge starts the deploy once; green checks deploy, close and comment once', async () => {
  const { id, n, sha } = await accepted('by label')
  await fake.tickets(repo).addLabels(n, ['bauherr:approved:production'])
  const t0 = Date.now()
  await release.watchProduction(payload, t0)
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: 'approve:production' } }, { actor: { equals: 'forge label' } }] }, ...o })).toMatchObject({ totalDocs: 1 })
  await release.watchProduction(payload, t0 + 1000)
  expect(await payload.count({ collection: 'human_touches', where: { ticket: { equals: id } }, ...o })).toMatchObject({ totalDocs: 2 })
  fake.setChecks(repo, sha, ok())
  expect((await release.watchProduction(payload, t0 + 1000)).released).toHaveLength(0)
  const { released } = await release.watchProduction(payload, t0 + release.WEBHOOK_SETTLE_MS + 1000)
  expect(released.map((r) => r.id)).toEqual([id])
  await release.watchProduction(payload, t0 + release.WEBHOOK_SETTLE_MS + 2000)
  expect(await reload(id)).toMatchObject({ productionState: 'deployed', stage: 'done', state: 'closed' })
  expect((await fake.tickets(repo).get(n)).state).toBe('closed')
  expect(await labels(n)).toContain('bauherr:stage:done')
  const posted = await comments(n)
  expect(posted).toHaveLength(1)
  expect(posted[0]!.body).toContain('succeeded')
})

it('the approval action POSTs the webhook exactly once and retries it after a non-2xx', async () => {
  const status = { hook: 500 }
  const fetchMock = vi.fn(async () => new Response(null, { status: status.hook }))
  vi.stubGlobal('fetch', fetchMock)
  await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: 'https://hook.example/prod' }, ...o })
  try {
    const { id } = await accepted('hooked')
    await actions.approveProduction(payload, user, { ticket: id })
    const t0 = Date.now()
    await release.watchProduction(payload, t0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    status.hook = 200
    await release.watchProduction(payload, t0 + 1000)
    await release.watchProduction(payload, t0 + 2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ environment: 'production' })
  } finally {
    vi.unstubAllGlobals()
    await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: null }, ...o })
  }
})

it('a red check fails the deploy and keeps the Ticket open; re-approval retries to deployed', async () => {
  const { id, n, sha } = await accepted('red')
  await actions.approveProduction(payload, user, { ticket: id })
  const t0 = Date.now()
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure' }])
  await release.watchProduction(payload, t0 + release.WEBHOOK_SETTLE_MS + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed', stage: 'release', state: 'open' })
  expect((await comments(n))[0]!.body).toContain('failed')
  await release.watchProduction(payload, t0 + release.WEBHOOK_SETTLE_MS + 2000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed' })

  await actions.approveProduction(payload, user, { ticket: id })
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure' }, { id: 2, name: 'deploy-prod', status: 'completed', conclusion: 'success' }])
  const t1 = Date.now()
  await release.watchProduction(payload, t1 + release.WEBHOOK_SETTLE_MS + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'deployed', state: 'closed' })
  const posted = await comments(n)
  expect(posted).toHaveLength(1)
  expect(posted[0]!.body).toContain('succeeded')
})

it('times out after 60 minutes without a result and keeps the Ticket open', async () => {
  const { id, n } = await accepted('late')
  await actions.approveProduction(payload, user, { ticket: id })
  const t0 = Date.now()
  await release.watchProduction(payload, t0 + release.PRODUCTION_TIMEOUT_MS - 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  await release.watchProduction(payload, t0 + release.PRODUCTION_TIMEOUT_MS + 5000)
  expect(await reload(id)).toMatchObject({ productionState: 'timed_out', state: 'open', stage: 'release' })
  expect((await comments(n))[0]!.body).toContain('timed out')
})
