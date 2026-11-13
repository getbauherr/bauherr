import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
let user: Record<string, unknown>
let ws: number
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({ redirect: () => {} }))
vi.mock('../src/app/(app)/lib/session', () => ({
  currentWorkspace: async () => ({ user, workspace: { id: ws } }),
  payloadClient: async () => payload,
  workspacesOf: async () => [{ id: ws }],
  getBauherr: async () => user,
  WS_COOKIE: 'bauherr-ws',
}))
const o = { overrideAccess: true } as const
const form = (fields: Record<string, string>) => Object.entries(fields).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData())

beforeAll(async () => {
  testDb = await createTestDb('monitoring_actions_571')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'ma', slug: 'ma' }, ...o })).id as number
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('the monitoring actions refuse a non-Admin and change nothing; a Bauherr cannot create or turn a row into kind monitoring', async () => {
  const actions = await import('../src/app/(app)/(shell)/settings/actions')
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'a@ma.io', password: 'pw-123456', role: 'admin' }, ...o })
  const member = await payload.create({ collection: 'bauherren', data: { email: 'b@ma.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const row = await payload.create({ collection: 'connections', data: { name: 'g', kind: 'monitoring', service: 'grafana', config: { url: 'https://g.example' }, workspace: ws } as never, ...o })

  user = member as never
  const save = await actions.saveMonitoring({}, form({ service: 'grafana', url: 'https://evil.example', id: String(row.id) }))
  const create = await actions.saveMonitoring({}, form({ service: 'otlp', host: 'c.example:4317' }))
  const remove = await actions.removeMonitoring({}, form({ id: String(row.id) }))
  const test = await actions.testMonitoringAction({}, form({ id: String(row.id) }))
  for (const r of [save, create, remove, test]) expect(r).toMatchObject({ error: 'Only an Admin can change this.' })
  const after = await payload.find({ collection: 'connections', where: { kind: { equals: 'monitoring' } }, ...o })
  expect(after.docs.map((d) => [d.id, d.config])).toEqual([[row.id, { url: 'https://g.example' }]])

  const asMember = { user: member, overrideAccess: false } as const
  await expect(payload.create({ collection: 'connections', data: { name: 'x', kind: 'monitoring', service: 'otlp', config: { host: 'c.example:4317' }, workspace: ws } as never, ...asMember })).rejects.toThrow()
  const github = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws, secret: 'x' } as never, ...o })
  await expect(payload.update({ collection: 'connections', id: github.id, data: { kind: 'monitoring', service: 'otlp', config: { host: 'c.example:4317' } } as never, ...asMember })).rejects.toThrow()
  expect((await payload.findByID({ collection: 'connections', id: github.id, ...o })).kind).toBe('github')

  user = admin as never
  expect(await actions.saveMonitoring({}, form({ service: 'grafana', url: 'https://g2.example', id: String(row.id) }))).toMatchObject({ saved: true })
})
