import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const o = { overrideAccess: true } as const
const repo = 'acme/web'
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let run: () => Promise<{ output: { changed: number } }>

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('notify_gates_task')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
  process.env.BAUHERR_BOT_LOGIN = 'fake'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { notifyGatesTask } = await import('../src/jobs')
  run = () => (notifyGatesTask.handler as (a: unknown) => Promise<{ output: { changed: number } }>)({ req: { payload } })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'fake' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('changes nothing while no Ticket waits at a gate', async () => {
  expect((await run()).output.changed).toBe(0)
})

it('notifies the gate owner of a plan Ticket once and reports the change count', async () => {
  const issue = await fake.tickets(repo).create({ title: 'gate', labels: ['bauherr:stage:plan'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'gate', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  expect((await run()).output.changed).toBe(1)
  expect(await payload.findByID({ collection: 'tickets', id: t.id, depth: 0, ...o })).toMatchObject({ gateNotified: 'Approve plan', gateAssignees: 'fake' })
  expect((await run()).output.changed).toBe(0)
})
