import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { parse, stringify } from 'yaml'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let factory: typeof import('../src/lib/factory')
let runCtx: typeof import('../src/lib/run-ctx')
let conn: typeof import('../src/lib/connection')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
type Doc = Record<string, any>
const by = { by: 'admin@x.io', via: 'api' } as const

let testDb: TestDb
let ws: number
let connection: number
let llmSlug: string
let ticket: Doc
beforeAll(async () => {
  testDb = await createTestDb('run_tier')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_URL = 'http://gateway.test'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  factory = await import('../src/lib/factory')
  runCtx = await import('../src/lib/run-ctx')
  conn = await import('../src/lib/connection')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  llmSlug = ((await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })) as Doc).slug
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  const issue = await fake.tickets(repo).create({ title: 't' })
  ticket = (await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', product, workspace: ws }, ...o })) as Doc
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const ctxOf = async (stage: string, extra: Doc = {}) => {
  const run = (await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage, status: 'queued', mode: 'autonomous', workspace: ws }, ...o })) as Doc
  const github = await conn.connectionInput(payload, connection)
  return runCtx.buildRunCtx(payload, { run: { ...run, ...extra }, ticket, repo, github, gatewayKey: 'k', defaultBranch: 'main' })
}
const tiers = async () => Object.fromEntries(await Promise.all(['triage', 'plan', 'build'].map(async (s) => [s, (await ctxOf(s)).run.tier])))
const editRoles = async (fn: (roles: Doc) => void) => {
  const d = parse(await factory.exportFactory(payload, ws)) as Doc
  fn(d.team.roles)
  expect(await factory.applyFactory(payload, ws, stringify(d), by)).toMatchObject({ ok: true })
}

it('the default pack gives triage the cheap tier, plan and build the standard tier and the review role the strong tier', async () => {
  expect(await tiers()).toEqual({ triage: 'cheap', plan: 'standard', build: 'standard' })
  expect((await import('../src/lib/workflow')).roleOf(factory.workflowFor(ws), 'review')?.tier).toBe('strong')
})

it('an escalated Run uses the strong tier', async () => {
  expect((await ctxOf('build', { escalation: { step: 2, reason: 'stuck', previousRuns: [] } })).run.tier).toBe('strong')
})

it('a role tier from the applied factory file drives the plan and build Runs', async () => {
  await editRoles((roles) => (roles.engineer.tier = 'cheap'))
  expect(await tiers()).toEqual({ triage: 'cheap', plan: 'cheap', build: 'cheap' })
  expect((await ctxOf('plan', { escalation: { step: 2, reason: 'stuck', previousRuns: [] } })).run.tier).toBe('strong')
})

it('a role with provider and model pins the gateway model id', async () => {
  await editRoles((roles) => {
    delete roles.orchestrator.tier
    Object.assign(roles.orchestrator, { provider: llmSlug, model: 'claude-x' })
  })
  expect((await ctxOf('triage')).run).toMatchObject({ model: `ws-acme/${llmSlug}/claude-x` })
  expect((await ctxOf('build')).run.model).toBeUndefined()
})
