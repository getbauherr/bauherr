import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../src/lib/settings-guards'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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

it('overlapIgnore takes a list of path globs without spaces, and only an Admin may change it', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'oi', slug: 'oi' }, ...o })
  const product = await payload.create({ collection: 'products', data: { name: 'oi', slug: 'oi', workspace: ws.id as number }, ...o })
  expect(product.overlapIgnore).toEqual([])
  await expect(payload.update({ collection: 'products', id: product.id, data: { overlapIgnore: ['a b'] }, ...o })).rejects.toThrow()
  await expect(payload.update({ collection: 'products', id: product.id, data: { overlapIgnore: 'CHANGELOG.md' as never }, ...o })).rejects.toThrow()
  expect((await payload.update({ collection: 'products', id: product.id, data: { overlapIgnore: ['CHANGELOG.md', 'src/gen/**'] }, ...o })).overlapIgnore).toEqual(['CHANGELOG.md', 'src/gen/**'])
  const member = await payload.create({ collection: 'bauherren', data: { email: 'oi@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws.id as number }] }, ...o })
  await payload.update({ collection: 'products', id: product.id, data: { overlapIgnore: [] }, user: member, overrideAccess: false }).catch(() => {})
  expect((await payload.findByID({ collection: 'products', id: product.id, ...o })).overlapIgnore).toEqual(['CHANGELOG.md', 'src/gen/**'])
})

it('unlockBauherr and createWorkspace: Admin-only, unlock clears the lock, create adds the tenant and keeps slugs unique', async () => {
  const actions = await import('../src/app/(app)/(shell)/settings/actions')
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'adm@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  const member = await payload.create({ collection: 'bauherren', data: { email: 'mem@x.io', password: 'pw-123456', role: 'bauherr' }, ...o })
  const locked = await payload.create({ collection: 'bauherren', data: { email: 'lock@x.io', password: 'pw-123456', role: 'bauherr' }, ...o })
  await payload.update({ collection: 'bauherren', id: locked.id, data: { lockUntil: new Date(Date.now() + 600_000).toISOString(), loginAttempts: 5 } as never, ...o })
  const as = async (user: typeof admin) => {
    const session = await import('../src/app/(app)/lib/session')
    vi.spyOn(session, 'currentWorkspace').mockResolvedValue({ user, workspaces: [], workspace: null } as never)
  }
  const form = (f: Record<string, string>) => Object.entries(f).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData())

  await as(member)
  expect((await actions.unlockBauherr({} as never, form({ id: String(locked.id) }))).error).toBeTruthy()
  expect((await actions.createWorkspace({} as never, form({ name: 'Nope' }))).error).toBeTruthy()

  await as(admin)
  expect((await actions.unlockBauherr({} as never, form({ id: String(locked.id) }))).saved).toBe(true)
  const after = (await payload.findByID({ collection: 'bauherren', id: locked.id, depth: 0, showHiddenFields: true, ...o })) as unknown as { lockUntil?: string | null; loginAttempts?: number }
  expect(after.lockUntil ?? null).toBeNull()
  expect(after.loginAttempts).toBe(0)

  expect((await actions.createWorkspace({} as never, form({ name: 'Second Workspace' }))).saved).toBe(true)
  const ws = (await payload.find({ collection: 'workspaces', where: { slug: { equals: 'second-workspace' } }, depth: 0, ...o })).docs[0]
  expect(ws).toBeTruthy()
  const me = (await payload.findByID({ collection: 'bauherren', id: admin.id, depth: 0, ...o })) as unknown as { tenants: { tenant: number }[] }
  expect(me.tenants.map((t) => t.tenant)).toContain(ws.id)
  expect((await actions.createWorkspace({} as never, form({ name: 'Again', slug: 'second-workspace' }))).error).toBeTruthy()
})
