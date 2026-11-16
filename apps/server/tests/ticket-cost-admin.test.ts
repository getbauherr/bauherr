import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The Ticket page's Cost block is for Admins: what a non-Admin's render carries has no cost number (the element tree of the page is what the RSC payload is made of). */
const session = vi.hoisted(() => ({ cookie: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true, depth: 0 } as const
const PASSWORD = 'pw-123456-cost'
const COST = 7.31

let payload: Payload
let testDb: TestDb
let ticket: number
let cookie: { admin: string; member: string }

beforeAll(async () => {
  testDb = await createTestDb('ticket_cost')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace }, ...o })
  ticket = (await payload.create({ collection: 'tickets', data: { title: 'Priced', externalId: 'c1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'build', product, workspace }, ...o })).id as number
  await payload.create({ collection: 'runs', data: { ticket, workspace, product, stage: 'build', kind: 'build', status: 'succeeded', costEstimateUsd: COST } as never, ...o })
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: PASSWORD, role: 'admin' }, ...o })
  const member = await payload.create({ collection: 'bauherren', data: { email: 'member@x.io', password: PASSWORD, role: 'bauherr', tenants: [{ tenant: workspace }] } as never, ...o })
  cookie = { admin: `bauherr-session=${signSession(admin.id, 0)}`, member: `bauherr-session=${signSession(member.id, 0)}` }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const tree = async (as: string): Promise<string> => {
  session.cookie = as
  const page = (await import('../src/app/(app)/(shell)/tickets/[id]/page')).default
  const skipComponents = (k: string, v: unknown) => (k === 'type' && typeof v !== 'string' ? undefined : v) // component references, not data
  return JSON.stringify(await page({ params: Promise.resolve({ id: String(ticket) }), searchParams: Promise.resolve({}) }), skipComponents)
}

describe('Ticket page cost', () => {
  it('an Admin render carries the Cost block with the Run cost', async () => {
    const out = await tree(cookie.admin)
    expect(out).toContain('"costUsd":7.31')
  })

  it('a non-Admin render carries no cost number', async () => {
    const out = await tree(cookie.member)
    expect(out).not.toMatch(/7\.31|costUsd|costEstimateUsd|gatewayCost/)
  })
})
