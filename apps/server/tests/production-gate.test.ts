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
const at = (ms: number) => new Date(Date.now() + ms).toISOString()
const ok = (name = 'deploy-prod', startedAt = at(5000)) => [{ name, status: 'completed', conclusion: 'success', startedAt }]

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

it('a label added on the forge by anyone does not start a deploy', async () => {
  const { id, n, sha } = await accepted('by label')
  await fake.tickets(repo).addLabels(n, ['bauherr:approved:production'])
  fake.setChecks(repo, sha, ok())
  await release.watchProduction(payload, Date.now() + 10 * 60_000)
  expect(await reload(id)).toMatchObject({ productionState: 'awaiting_approval', stage: 'release', state: 'open' })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: 'approve:production' } }] }, ...o })).toMatchObject({ totalDocs: 0 })
})

it('a production approval without a named person is refused and leaves no touch', async () => {
  const { id } = await accepted('nameless')
  await expect(actions.approveProduction(payload, { ...user, email: '' }, { ticket: id })).rejects.toThrow('a human touch needs a named person')
  expect(await reload(id)).toMatchObject({ productionState: 'awaiting_approval' })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: 'approve:production' } }] }, ...o })).toMatchObject({ totalDocs: 0 })
})

it('the owner approval records the sha, deploys once on green checks, closes and comments once', async () => {
  const { id, n, sha } = await accepted('approved')
  await actions.approveProduction(payload, user, { ticket: id })
  expect(await reload(id)).toMatchObject({ productionState: 'deploying', productionApprovedSha: sha })
  expect(await labels(n)).toContain('bauherr:approved:production')
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: 'approve:production' } }, { actor: { equals: user.email } }] }, ...o })).toMatchObject({ totalDocs: 1 })
  const t0 = Date.now()
  expect((await release.watchProduction(payload, t0)).released).toHaveLength(0)
  fake.setChecks(repo, sha, ok())
  const { released } = await release.watchProduction(payload, t0 + 1000)
  expect(released.map((r) => r.id)).toEqual([id])
  await release.watchProduction(payload, t0 + 2000)
  expect(await reload(id)).toMatchObject({ productionState: 'deployed', stage: 'done', state: 'closed' })
  expect((await fake.tickets(repo).get(n)).state).toBe('closed')
  expect(await labels(n)).toContain('bauherr:stage:done')
  const posted = await comments(n)
  expect(posted).toHaveLength(1)
  expect(posted[0]!.body).toContain('succeeded')
})

it('a check that predates the approval does not deploy; an old red run does not fail the retry', async () => {
  const { id, sha } = await accepted('stale checks')
  fake.setChecks(repo, sha, ok('deploy-prod', at(-120_000)))
  await actions.approveProduction(payload, user, { ticket: id })
  await release.watchProduction(payload, Date.now() + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure', startedAt: at(-120_000) }])
  await release.watchProduction(payload, Date.now() + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure', startedAt: at(-120_000) }, { id: 2, name: 'deploy-prod', status: 'completed', conclusion: 'success', startedAt: at(5000) }])
  await release.watchProduction(payload, Date.now() + 2000)
  expect(await reload(id)).toMatchObject({ productionState: 'deployed' })
})

it('a failed deploy spends the approval: re-accepting needs a new approval', async () => {
  const { id, n, sha } = await accepted('spent')
  await actions.approveProduction(payload, user, { ticket: id })
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure', startedAt: at(5000) }])
  await release.watchProduction(payload, Date.now() + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed', productionApprovedSha: null })
  expect(await labels(n)).not.toContain('bauherr:approved:production')
  await actions.acceptStaging(payload, user, { ticket: id })
  fake.setChecks(repo, sha, ok())
  await release.watchProduction(payload, Date.now() + 10 * 60_000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed', stage: 'release', state: 'open' })
})

it('request_changes and a new merge reset the approval; accepting again needs a new approval', async () => {
  const { id, n, sha } = await accepted('reset')
  await actions.approveProduction(payload, user, { ticket: id })
  await actions.requestChanges(payload, user, { ticket: id, note: 'again' })
  expect(await reload(id)).toMatchObject({ stage: 'build', productionState: null, productionApprovedSha: null })
  expect(await labels(n)).not.toContain('bauherr:approved:production')
  await payload.update({ collection: 'tickets', id, data: { stage: 'release', releaseState: 'on_staging', mergeSha: 'sha-new' }, ...o })
  await actions.acceptStaging(payload, user, { ticket: id })
  fake.setChecks(repo, 'sha-new', ok())
  await release.watchProduction(payload, Date.now() + 10 * 60_000)
  expect(await reload(id)).toMatchObject({ productionState: 'awaiting_approval' })
  void sha
})

it('accepting again never overwrites a deploying or deployed production state', async () => {
  const { id } = await accepted('twice')
  await actions.acceptStaging(payload, user, { ticket: id })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: 'accept:staging' } }] }, ...o })).toMatchObject({ totalDocs: 2 })
  await actions.approveProduction(payload, user, { ticket: id })
  await actions.acceptStaging(payload, user, { ticket: id })
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
})

it('a label failure after the CAS keeps the deploy and is retried by the watcher', async () => {
  const { id, n } = await accepted('label flaky')
  const ts = fake.tickets(repo)
  const add = vi.spyOn(Object.getPrototypeOf(ts), 'addLabels').mockRejectedValueOnce(new Error('forge down'))
  try {
    await actions.approveProduction(payload, user, { ticket: id })
    expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
    expect(await labels(n)).not.toContain('bauherr:approved:production')
  } finally {
    add.mockRestore()
  }
  await release.watchProduction(payload, Date.now())
  expect(await labels(n)).toContain('bauherr:approved:production')
})

it('the approval action POSTs the webhook exactly once and retries it after a non-2xx', async () => {
  const status = { hook: 500 }
  const fetchMock = vi.fn(async () => new Response(null, { status: status.hook }))
  vi.stubGlobal('fetch', fetchMock)
  await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: 'https://hook.example/prod' }, ...o })
  try {
    const { id, n } = await accepted('hooked')
    const mine = () => fetchMock.mock.calls.filter((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).ticket === Number(n))
    await actions.approveProduction(payload, user, { ticket: id })
    const t0 = Date.now()
    await release.watchProduction(payload, t0)
    expect(mine()).toHaveLength(1)
    status.hook = 200
    await release.watchProduction(payload, t0 + 1000)
    await release.watchProduction(payload, t0 + 2000)
    expect(mine()).toHaveLength(2)
    expect(JSON.parse((mine()[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ environment: 'production' })
  } finally {
    vi.unstubAllGlobals()
    await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: null }, ...o })
  }
})

it('a red check fails the deploy and keeps the Ticket open; re-approval retries to deployed', async () => {
  const { id, n, sha } = await accepted('red')
  await actions.approveProduction(payload, user, { ticket: id })
  const t0 = Date.now()
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure', startedAt: at(5000) }])
  await release.watchProduction(payload, t0 + release.WEBHOOK_SETTLE_MS + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed', stage: 'release', state: 'open' })
  expect((await comments(n))[0]!.body).toContain('failed')
  await release.watchProduction(payload, t0 + release.WEBHOOK_SETTLE_MS + 2000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed' })

  const first = at(0)
  await new Promise((r) => setTimeout(r, 10))
  await actions.approveProduction(payload, user, { ticket: id })
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  fake.setChecks(repo, sha, [{ id: 1, name: 'deploy-prod', status: 'completed', conclusion: 'failure', startedAt: first }, { id: 2, name: 'deploy-prod', status: 'completed', conclusion: 'success', startedAt: at(5000) }])
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

it('the approve_production tool is refused while a session Run holds the Ticket', async () => {
  const { id } = await accepted('agent held')
  const run = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', mode: 'session', status: 'running', workspace: ws }, ...o })
  const { tools } = await import('../src/lib/mcp-tools')
  const approve = tools.find((t) => t.name === 'approve_production')!
  await expect(approve.run({ ticket: id }, { payload, user, actor: { kind: 'human' } })).rejects.toThrow('session Run holds')
  expect(await reload(id)).toMatchObject({ productionState: 'awaiting_approval' })
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'succeeded' }, ...o })
  await expect(approve.run({ ticket: id }, { payload, user, actor: { kind: 'human' } })).resolves.toMatchObject({ productionState: 'deploying' })
})

const failOnce = (ts: object) => vi.spyOn(Object.getPrototypeOf(ts), 'addLabels').mockRejectedValueOnce(new Error('forge down'))
const adds = (spy: ReturnType<typeof vi.spyOn>, n: string) => spy.mock.calls.filter((c: unknown[]) => (c[0] as string) === n && (c[1] as string[]).includes('bauherr:approved:production')).length

it('delivers the output label once: a removal after a successful add is never undone', async () => {
  const { id, n } = await accepted('label once')
  const ts = fake.tickets(repo)
  const spy = vi.spyOn(Object.getPrototypeOf(ts), 'addLabels')
  try {
    await actions.approveProduction(payload, user, { ticket: id })
    expect((await reload(id)).productionLabelAt).toBeTruthy()
    await ts.removeLabels(n, ['bauherr:approved:production'])
    await release.watchProduction(payload, Date.now())
    await release.watchProduction(payload, Date.now() + 1000)
    expect(adds(spy, n)).toBe(1)
    expect(await labels(n)).not.toContain('bauherr:approved:production')
  } finally {
    spy.mockRestore()
  }
})

it('retries a failed first label add until one succeeds, then never again', async () => {
  const { id, n } = await accepted('label retry')
  const ts = fake.tickets(repo)
  const spy = failOnce(ts)
  try {
    await actions.approveProduction(payload, user, { ticket: id })
    expect((await reload(id)).productionLabelAt).toBeFalsy()
    await release.watchProduction(payload, Date.now())
    expect((await reload(id)).productionLabelAt).toBeTruthy()
    await ts.removeLabels(n, ['bauherr:approved:production'])
    await release.watchProduction(payload, Date.now() + 1000)
    expect(adds(spy, n)).toBe(2)
  } finally {
    spy.mockRestore()
  }
})

it('never adds the label to a Ticket that stopped deploying since the tick listed it', async () => {
  const { id, n } = await accepted('no longer deploying')
  const ts = fake.tickets(repo)
  const spy = failOnce(ts)
  try {
    await actions.approveProduction(payload, user, { ticket: id })
    const stale = await payload.find({ collection: 'tickets', where: { id: { equals: id } }, depth: 0, ...o })
    await payload.update({ collection: 'tickets', id, data: { productionState: 'failed', productionApprovedSha: null }, ...o })
    const find = vi.spyOn(payload, 'find').mockResolvedValueOnce(stale as never)
    await release.watchProduction(payload, Date.now())
    find.mockRestore()
    expect(adds(spy, n)).toBe(1)
    expect(await labels(n)).not.toContain('bauherr:approved:production')
  } finally {
    spy.mockRestore()
  }
})

it('a skipped or neutral deploy check is not a deploy: the Ticket fails with a reason', async () => {
  for (const conclusion of ['skipped', 'neutral']) {
    const { id, n, sha } = await accepted(`not ${conclusion}`)
    await actions.approveProduction(payload, user, { ticket: id })
    fake.setChecks(repo, sha, [{ name: 'deploy-prod', status: 'completed', conclusion, startedAt: at(5000) }])
    await release.watchProduction(payload, Date.now() + 1000)
    expect(await reload(id)).toMatchObject({ productionState: 'failed', stage: 'release', state: 'open' })
    expect((await comments(n))[0]!.body).toContain('deploy check skipped')
  }
})

it('counts a check that started up to 60 s before the approval, not earlier', async () => {
  const { id, sha } = await accepted('skew')
  await actions.approveProduction(payload, user, { ticket: id })
  fake.setChecks(repo, sha, ok('deploy-prod', at(-90_000)))
  await release.watchProduction(payload, Date.now() + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'deploying' })
  fake.setChecks(repo, sha, ok('deploy-prod', at(-30_000)))
  await release.watchProduction(payload, Date.now() + 2000)
  expect(await reload(id)).toMatchObject({ productionState: 'deployed' })
})

it('fails the deploy when the approved sha is not the merge sha any more', async () => {
  const { id, n, sha } = await accepted('sha drift')
  await actions.approveProduction(payload, user, { ticket: id })
  await payload.update({ collection: 'tickets', id, data: { mergeSha: 'sha-other' }, ...o })
  fake.setChecks(repo, 'sha-other', ok())
  fake.setChecks(repo, sha, ok())
  await release.watchProduction(payload, Date.now() + 1000)
  expect(await reload(id)).toMatchObject({ productionState: 'failed', stage: 'release' })
  expect((await comments(n))[0]!.body).toContain('does not match the merge commit')
})

it('two parallel approvals: one wins, one touch, one label, one webhook', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: 'https://hook.example/prod' }, ...o })
  const ts = fake.tickets(repo)
  const spy = vi.spyOn(Object.getPrototypeOf(ts), 'addLabels')
  try {
    const { id, n } = await accepted('double click')
    const results = await Promise.allSettled([actions.approveProduction(payload, user, { ticket: id }), actions.approveProduction(payload, user, { ticket: id })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: 'approve:production' } }] }, ...o })).toMatchObject({ totalDocs: 1 })
    await Promise.all([release.watchProduction(payload, Date.now()), release.watchProduction(payload, Date.now())])
    expect(adds(spy, n)).toBe(1)
    expect(fetchMock.mock.calls.filter((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).ticket === Number(n))).toHaveLength(1)
  } finally {
    spy.mockRestore()
    vi.unstubAllGlobals()
    await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: null }, ...o })
  }
})

it('accepting again repairs a staging label whose first add failed', async () => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title: 'accept flaky', labels: ['bauherr:stage:release'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'accept flaky', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'release', releaseState: 'on_staging', mergeSha: 'sha-af', product, workspace: ws }, ...o })
  const spy = failOnce(ts)
  try {
    await expect(actions.acceptStaging(payload, user, { ticket: t.id as number })).rejects.toThrow('forge down')
  } finally {
    spy.mockRestore()
  }
  expect(await labels(String(issue.number))).not.toContain('bauherr:approved:staging')
  await actions.acceptStaging(payload, user, { ticket: t.id as number })
  await actions.acceptStaging(payload, user, { ticket: t.id as number })
  expect(await labels(String(issue.number))).toContain('bauherr:approved:staging')
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'accept:staging' } }] }, ...o })).toMatchObject({ totalDocs: 3 })
})

it('sends an idempotency header with the production webhook', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: 'https://hook.example/prod' }, ...o })
  try {
    const { id, n, sha } = await accepted('delivery header')
    await actions.approveProduction(payload, user, { ticket: id })
    await release.watchProduction(payload, Date.now())
    const call = fetchMock.mock.calls.find((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).ticket === Number(n)) as unknown as [string, RequestInit]
    expect((call[1].headers as Record<string, string>)['x-bauherr-delivery']).toBe(`${n}-${sha}`)
  } finally {
    vi.unstubAllGlobals()
    await payload.update({ collection: 'products', id: product, data: { productionWebhookUrl: null }, ...o })
  }
})
