import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let outsider: Record<string, any>
let product: number
let ws: number
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const MARKER = '<!-- bauherr:plan -->'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_submit_plan WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_submit_plan')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_submit_plan')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  outsider = await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

const seed = async (stage: 'plan' | 'build' = 'plan') => {
  const issue = await fake.tickets(repo).create({ title: 'x' })
  const ticket = await payload.create({ collection: 'tickets', data: { title: 'x', externalId: String(issue.number), number: issue.number, state: 'open', labels: [], stage, product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage, mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
  return { n: String(issue.number), run }
}
const plans = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith(MARKER))

it('posts the plan comment once and updates it on a second call', async () => {
  const { n, run } = await seed()
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await expect(call(member, 'submit_plan', { runId: run.id, leaseToken, markdown: '## Goal\none' })).resolves.toMatchObject({ created: true })
  await expect(call(member, 'submit_plan', { runId: run.id, leaseToken, markdown: `${MARKER}\n## Goal\ntwo` })).resolves.toMatchObject({ created: false })
  const comments = await plans(n)
  expect(comments).toHaveLength(1)
  expect(comments[0]!.body).toBe(`${MARKER}\n## Goal\ntwo`)
})

it('only the lease holder of a running plan Run may call it', async () => {
  const { n, run } = await seed()
  await expect(call(member, 'submit_plan', { runId: run.id, leaseToken: 'x'.repeat(43), markdown: 'p' })).rejects.toThrow('is awaiting_session')
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await expect(call(member, 'submit_plan', { runId: run.id, leaseToken: 'x'.repeat(43), markdown: 'p' })).rejects.toThrow('leased by another session')
  await expect(call(outsider, 'submit_plan', { runId: run.id, leaseToken, markdown: 'p' })).rejects.toThrow()
  expect(await plans(n)).toHaveLength(0)
})

it('refuses a build Run', async () => {
  const { run } = await seed('build')
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await expect(call(member, 'submit_plan', { runId: run.id, leaseToken, markdown: 'p' })).rejects.toThrow('not a plan Run')
})

const finish = async (stage: 'plan' | 'build', input: Record<string, unknown>) => {
  const { n, run } = await seed(stage)
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  if (input.prUrl) {
    const head = `bauherr/${n}-x`
    await fake.forge.createBranch(repo, head)
    fake.commit(repo, head, 'a.ts', n)
    input = { ...input, prUrl: (await fake.forge.openPullRequest(repo, { title: 't', head, base: 'main' })).url }
  }
  await call(member, 'finish_run', { runId: run.id, leaseToken, ...input })
  const ticket = (await payload.findByID({ collection: 'tickets', id: (run.ticket as any).id ?? run.ticket, ...o })) as Record<string, any>
  return { stage: ticket.stage, labels: (await fake.tickets(repo).get(n)).labels }
}

it('finish_run succeeded with a prUrl moves a built Ticket to review', async () => {
  const r = await finish('build', { status: 'succeeded', prUrl: 'make' })
  expect(r.stage).toBe('review')
  expect(r.labels).toContain('bauherr:stage:review')
})

it('finish_run without a prUrl, failed, or on a plan Run leaves the stage', async () => {
  expect((await finish('build', { status: 'succeeded' })).stage).toBe('build')
  expect((await finish('build', { status: 'failed', reason: 'r', prUrl: 'make' })).stage).toBe('build')
  expect((await finish('plan', { status: 'succeeded', prUrl: 'make' })).stage).toBe('plan')
})
