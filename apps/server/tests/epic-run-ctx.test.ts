import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let fake: FakeBackend
let runCtx: typeof import('../src/lib/run-ctx')
let conn: typeof import('../src/lib/connection')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
let ws: number
let product: number
let connection: number
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb('epic_run_ctx')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_URL = 'http://gateway.test'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  runCtx = await import('../src/lib/run-ctx')
  conn = await import('../src/lib/connection')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const ticket = async (title: string, stage: string, extra: Doc = {}) => {
  const issue = await fake.tickets(repo).create({ title })
  return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws, ...extra }, ...o })) as Doc
}
const ctxOf = async (t: Doc, stage: string) => {
  const run = (await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: 'queued', mode: 'autonomous', workspace: ws }, ...o })) as Doc
  return runCtx.buildRunCtx(payload, { run, ticket: t, repo, github: await conn.connectionInput(payload, connection), gatewayKey: 'k', defaultBranch: 'main' })
}

it('a slice gets the epic branch, the parent title as MR title, its range and the epic worklog; slice 1 does not merge main, later ones do; the epic PR is the existing PR', async () => {
  const parent = await ticket('Big epic', 'parent')
  await fake.tickets(repo).comment(String(parent.number), '<!-- bauherr:worklog -->\n**Decisions**\n- shared interface')
  const branch = `bauherr/${parent.number}-epic`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 'Big epic', body: 'b', head: branch, base: 'main' })
  const one = await ticket('One', 'done', { parent: parent.id, slice: { epic: parent.id, branch, index: 0, prev: null, main: null, head: 'h0', passed: true, fixes: [{ sha: 'f1', finding: 'fix' }] } })
  const two = await ticket('Two', 'build', { parent: parent.id, slice: { epic: parent.id, branch, index: 1, prev: 'h0', main: 'm0', head: null, passed: false, fixes: [] } })
  await payload.update({ collection: 'tickets', id: parent.id, data: { epic: { branch, pr: pr.url, slices: [{ title: 'One', body: '', ticket: one.id }, { title: 'Two', body: '', ticket: two.id }, { title: 'Three', body: '' }], current: 1, mergeFailures: 0 } }, ...o })

  const ctx = await ctxOf(two, 'build')
  expect(ctx).toMatchObject({ branch, prTitle: 'Big epic', slice: { prev: 'h0', mergeMain: true }, existingPr: { number: pr.number, branch } })
  expect(ctx.epic).toMatchObject({ parent: parent.number, slices: [{ number: one.number, title: 'One', prev: null, head: 'h0', fixes: [{ sha: 'f1', finding: 'fix' }] }, { number: two.number, title: 'Two', prev: 'h0', head: null, fixes: [] }] })
  expect(ctx.epic!.worklog).toContain('shared interface')
  expect((await ctxOf(one, 'build')).slice).toEqual({ prev: null, mergeMain: false })

  const top = await ctxOf(await payload.findByID({ collection: 'tickets', id: parent.id, depth: 0, ...o }) as Doc, 'review')
  expect(top).toMatchObject({ branch, existingPr: { number: pr.number } })
  expect(top.slice).toBeUndefined()
  expect(top.prTitle).toBeUndefined()
  expect(top.epic!.slices).toHaveLength(2)
})

it('a Ticket without epic or slice gets none of the epic fields', async () => {
  const ctx = await ctxOf(await ticket('plain', 'plan'), 'plan')
  for (const k of ['branch', 'prTitle', 'slice', 'epic']) expect(ctx).not.toHaveProperty(k)
})
