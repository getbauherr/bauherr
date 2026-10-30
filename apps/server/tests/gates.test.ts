import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let gates: typeof import('../src/lib/gates')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_gates WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_gates')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_gates')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  gates = await import('../src/lib/gates')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'fake' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

/** A plan Ticket whose plan Run succeeded: the Approve plan gate. */
const planTicket = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:plan'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  return { id: t.id as number, n: String(issue.number) }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const gateComments = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:gate:'))
const issue = (n: string) => (fake.tickets(repo) as any).t(n) as { assignee: string | null }

it('assigns and mentions the Admin once per gate, and clears both when the gate is passed', async () => {
  const { id, n } = await planTicket('gate')
  await gates.syncGates(payload)
  await gates.syncGates(payload)
  const [c, ...rest] = await gateComments(n)
  expect(rest).toHaveLength(0)
  expect(c.body).toMatch(/^<!-- bauherr:gate:Approve plan:[0-9a-f]{40} -->\n@fake: Approve plan — .*\/tickets\/\d+$/)
  expect(issue(n).assignee).toBe('fake')
  expect(await reload(id)).toMatchObject({ gateNotified: 'Approve plan', gateAssignees: 'fake' })

  await payload.update({ collection: 'tickets', id, data: { labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] }, ...o })
  await gates.syncGates(payload)
  expect(issue(n).assignee).toBeNull()
  expect(await reload(id)).toMatchObject({ gateNotified: null, gateNotifiedAt: null, gateAssignees: '' })
})

it('keeps an assignee the factory did not add', async () => {
  const { id, n } = await planTicket('self-assigned')
  await gates.syncGates(payload)
  await fake.tickets(repo).claim(n, 'e2e-admin')
  await payload.update({ collection: 'tickets', id, data: { assignee: 'e2e-admin', labels: ['bauherr:approved:plan'] }, ...o })
  await gates.syncGates(payload)
  expect(issue(n).assignee).toBe('e2e-admin')
  expect((await reload(id)).gateNotified).toBeNull()
})

it('uses the Product gateOwners over the Admins and skips a failing login', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'ghost, e2e-admin' }, ...o })
  const { n } = await planTicket('owners')
  await gates.syncGates(payload)
  expect(issue(n).assignee).toBe('e2e-admin')
  expect((await gateComments(n))[0].body).toContain('@ghost @e2e-admin: Approve plan')
})
