import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../src/lib/settings-guards'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('settings')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('refuses a change that would leave no Admin', async () => {
  const only = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  await expect(assertAnotherAdmin(payload, only.id as number)).rejects.toThrow('Add another Admin first')
  const second = await payload.create({ collection: 'bauherren', data: { email: 'b@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  await expect(assertAnotherAdmin(payload, only.id as number)).resolves.toBeUndefined()
  await expect(assertAnotherAdmin(payload, second.id as number)).resolves.toBeUndefined()
})

it('rejects a Connection of a foreign Workspace', async () => {
  const [mine, other] = await Promise.all(['mine', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))
  const c = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: other!.id as number }, ...o })
  await expect(assertInWorkspace(payload, 'connections', [c.id as number], mine!.id as number)).rejects.toThrow('Not in this Workspace')
  await expect(assertInWorkspace(payload, 'connections', [c.id as number], other!.id as number)).resolves.toBeUndefined()
})

it('a workflow version blocks deleting its Product', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'w', slug: 'w' }, ...o })
  const product = await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace: ws.id as number }, ...o })
  expect(await blockedBy(payload, 'products', product.id as number)).toBe('')
  await payload.create({ collection: 'workflow_versions', data: { version: 1, product: product.id as number, workspace: ws.id as number, compiled: {} }, ...o })
  expect(await blockedBy(payload, 'products', product.id as number)).toBe('1 workflow versions')
})

it('stores a gitlab Connection with its base URL', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'gl', slug: 'gl' }, ...o })
  const c = await payload.create({ collection: 'connections', data: { name: 'gl', kind: 'gitlab', config: { baseUrl: 'https://git.einsfuenf.de' }, secret: 'glpat', workspace: ws.id as number }, ...o })
  expect(await payload.findByID({ collection: 'connections', id: c.id, ...o })).toMatchObject({ kind: 'gitlab', config: { baseUrl: 'https://git.einsfuenf.de' } })
})

it('a Ticket, a widget token or an intake session blocks deleting its Product', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'bw', slug: 'bw' }, ...o })
  const make = async (slug: string) => (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws.id as number }, ...o })).id as number
  const [a, b, c] = [await make('bt'), await make('bk'), await make('bi')]
  await payload.create({ collection: 'tickets', data: { title: 't', externalId: 'bw-1', number: 1, url: 'https://x/1', state: 'open', product: a, workspace: ws.id as number }, ...o })
  await payload.create({ collection: 'embed_tokens', data: { name: 'w', product: b, tokenHash: 'bw-hash', workspace: ws.id as number }, ...o })
  await payload.create({ collection: 'intake_sessions', data: { product: c, workspace: ws.id as number }, ...o })
  expect(await blockedBy(payload, 'products', a)).toBe('1 tickets')
  expect(await blockedBy(payload, 'products', b)).toBe('1 widget tokens')
  expect(await blockedBy(payload, 'products', c)).toBe('1 intake sessions')
})
