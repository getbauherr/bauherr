import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const session = vi.hoisted(() => ({ cookie: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true, depth: 0 } as const
let payload: Payload
let testDb: TestDb
let ticket: number
let workspace: number

beforeAll(async () => {
  testDb = await createTestDb('changes_route')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  workspace = (await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o })).id as number
  ticket = (await payload.create({ collection: 'tickets', data: { title: 'T', externalId: 'c1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'build', product, workspace }, ...o })).id as number
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  session.cookie = `bauherr-session=${signSession(admin.id, 0)}`
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const version = async (): Promise<number> => ((await (await import('../src/app/api/changes/route')).GET()).json() as Promise<{ v: number }>).then((r) => r.v)

it('moves when a proof artifact or a human touch of a Ticket changes', async () => {
  const v0 = await version()
  await new Promise((r) => setTimeout(r, 20))
  await payload.create({ collection: 'artifacts', data: { ticket, workspace, kind: 'report', title: 'Report', text: 'ok', sha: 'abc' } as never, ...o })
  const v1 = await version()
  expect(v1).toBeGreaterThan(v0)
  await new Promise((r) => setTimeout(r, 20))
  await payload.create({ collection: 'human_touches', data: { ticket, workspace, kind: 'gate:plan', actor: 'a', at: new Date().toISOString() } as never, ...o })
  expect(await version()).toBeGreaterThan(v1)
})

it('moves when a Run reports a Step', async () => {
  const run = (await payload.create({ collection: 'runs', data: { ticket, workspace, stage: 'build', status: 'running', mode: 'session' } as never, ...o })).id as number
  const v0 = await version()
  await new Promise((r) => setTimeout(r, 20))
  await payload.create({ collection: 'steps', data: { run, workspace, seq: 1, summary: 'Read the plan' } as never, ...o })
  expect(await version()).toBeGreaterThan(v0)
})
