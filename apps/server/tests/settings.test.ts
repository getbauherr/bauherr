import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../src/lib/settings-guards'

let payload: Payload
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_settings WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_settings')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_settings')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
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
