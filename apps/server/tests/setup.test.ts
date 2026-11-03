import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let signedIn: { user: unknown; workspace: { id: number } }
vi.mock('../src/app/(app)/lib/session', () => ({ currentWorkspace: async () => signedIn, payloadClient: async () => payload, workspacesOf: async () => [] }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('../src/lib/adapters', () => ({ backendFor: (c: { secret: string | null }) => ({ tickets: () => ({ whoami: async () => (c.secret === 'ghp_x' ? 'me' : Promise.reject(new Error('Bad credentials'))) }) }) }))
let actions: typeof import('../src/app/(app)/(shell)/settings/actions')
let ws: number
const o = { overrideAccess: true } as const
const form = (data: Record<string, string | number>) => Object.entries(data).reduce((fd, [k, v]) => (fd.set(k, String(v)), fd), new FormData())
const count = async (collection: string) => (await payload.count({ collection, where: { workspace: { equals: ws } }, ...o } as never)).totalDocs

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('setup_233')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/app/(app)/(shell)/settings/actions')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'newco', slug: 'newco' }, ...o })).id as number
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  signedIn = { user: admin, workspace: { id: ws } }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('a Member who is not Admin cannot add a Product, skip or verify', async () => {
  const member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const admin = signedIn
  signedIn = { user: member, workspace: { id: ws } }
  const denied = { error: 'Only an Admin can change this.' }
  expect(await actions.createProductWithRepo({}, form({ name: 'Shop', fullName: 'acme/shop' }))).toEqual(denied)
  expect(await actions.skipDeploy({}, form({ id: 1 }))).toEqual(denied)
  expect(await actions.verifyConnection({}, form({ id: 1 }))).toEqual(denied)
  expect(await count('products')).toBe(0)
  signedIn = admin
})

it('walks the four steps: each is To do until its data exists', async () => {
  const { loadSetup } = await import('../src/app/(app)/lib/setup')
  const state = async () => (await loadSetup(ws)).steps.map((s) => s.done)
  expect(await state()).toEqual([false, false, false, false])

  expect(await actions.saveConnection({}, form({ name: 'GitHub', kind: 'github', secret: 'ghp_x' }))).toMatchObject({ saved: true })
  expect(await state()).toEqual([false, false, false, false])
  const connection = (await payload.find({ collection: 'connections', where: { workspace: { equals: ws } }, ...o })).docs[0]!.id as number
  expect(await actions.verifyConnection({}, form({ id: connection }))).toMatchObject({ saved: true })
  expect(await state()).toEqual([true, false, false, false])

  expect(await actions.createProductWithRepo({}, form({ name: 'Shop', fullName: 'acme/shop', connection }))).toMatchObject({ saved: true })
  expect(await count('repositories')).toBe(1)
  expect(await count('ticket_sources')).toBe(1)
  expect(await state()).toEqual([true, true, false, false])

  const product = (await loadSetup(ws)).product!.id
  await new Promise((r) => setTimeout(r, 1100))
  expect(await actions.skipDeploy({}, form({ id: product }))).toMatchObject({ saved: true })
  expect(await state()).toEqual([true, true, true, false])

  await payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], draft: { problem: 'x', context: '', acceptance_criteria: [], type: 'bug', links: [] } }, ...o })
  expect(await state()).toEqual([true, true, true, true])
  expect((await loadSetup(ws)).current).toBeUndefined()
})

it('a failing ticket source leaves no Product, repository or source behind', async () => {
  const connection = (await payload.find({ collection: 'connections', where: { workspace: { equals: ws } }, ...o })).docs[0]!.id as number
  const before = { products: await count('products'), repositories: await count('repositories'), sources: await count('ticket_sources') }
  const create = payload.create.bind(payload)
  const spy = vi.spyOn(payload, 'create').mockImplementation(((args: { collection: string }) => (args.collection === 'ticket_sources' ? Promise.reject(new Error('boom')) : create(args as never))) as never)
  expect(await actions.createProductWithRepo({}, form({ name: 'Half', fullName: 'acme/half', connection }))).toEqual({ error: 'boom' })
  spy.mockRestore()
  expect({ products: await count('products'), repositories: await count('repositories'), sources: await count('ticket_sources') }).toEqual(before)
})

it('a token the forge rejects is recorded as failed and the step stays To do', async () => {
  const bad = await payload.create({ collection: 'connections', data: { name: 'No secret', kind: 'github', workspace: ws }, ...o })
  expect(await actions.verifyConnection({}, form({ id: bad.id }))).toMatchObject({ error: expect.stringContaining('The forge did not accept the token') })
  const { loadConnections } = await import('../src/app/(app)/lib/settings')
  expect((await loadConnections(ws)).find((c) => c.id === bad.id)?.status).toBe('failed')
})
