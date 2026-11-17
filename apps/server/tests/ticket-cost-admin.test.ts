import type { Payload } from 'payload'
import { renderToReadableStream } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The Ticket page's Cost block is for Admins: what a non-Admin's render carries has no cost number (the element tree of the page is what the RSC payload is made of). */
const session = vi.hoisted(() => ({ cookie: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/tickets/1', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true, depth: 0 } as const
const PASSWORD = 'pw-123456-cost'
const COST = 7.3142

let payload: Payload
let testDb: TestDb
let ticket: number
let workspaceId: number
let productId: number
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
  workspaceId = workspace
  const product = (await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  productId = product
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

/** The page rendered to HTML with its async Suspense parts resolved (the client components render their first pass). */
const html = async (as: string): Promise<string> => {
  session.cookie = as
  const page = (await import('../src/app/(app)/(shell)/tickets/[id]/page')).default
  const element = await page({ params: Promise.resolve({ id: String(ticket) }), searchParams: Promise.resolve({}) })
  const stream = await renderToReadableStream(element as never)
  await stream.allReady
  return await new Response(stream).text()
}

describe('Ticket page cost', () => {
  it('an Admin render carries the Cost block with the Run cost', async () => {
    const out = await html(cookie.admin)
    expect(out).toMatch(/data-testid="cost-total"[^>]*>(<!-- -->)?\$(<!-- -->)?7\.31/)
  })

  it('the total is labelled estimated unless the gateway priced it', async () => {
    expect(await html(cookie.admin)).toContain('data-testid="cost-estimated"')
  })

  it('session Runs without reported usage are counted in a line, not priced as $0', async () => {
    const own = ticket
    ticket = (await payload.create({ collection: 'tickets', data: { title: 'Session', externalId: 'c2', number: 2, url: 'https://x/2', state: 'open', labels: [], stage: 'build', product: productId, workspace: workspaceId }, ...o })).id as number
    const run = (data: object) => payload.create({ collection: 'runs', data: { ticket, workspace: workspaceId, product: productId, stage: 'build', kind: 'build', status: 'succeeded', mode: 'session', executor: 'session', ...data } as never, ...o })
    await run({ costEstimateUsd: 0 })
    await run({ costEstimateUsd: 0 })
    const none = await html(cookie.admin)
    expect(none).toContain('No priced Runs yet.')
    expect(none).toMatch(/data-testid="cost-unreported"[^>]*>(<!-- -->)?2(<!-- -->)? session(<!-- -->)? (<!-- -->)?Runs(<!-- -->)? did not report usage/)
    expect(none).toContain('npx bauherr hook install')
    await run({ costEstimateUsd: 1.5, tokensIn: 100 })
    const some = await html(cookie.admin)
    expect(some).toMatch(/data-testid="cost-total"[^>]*>(<!-- -->)?\$(<!-- -->)?1\.50/)
    expect(some).toContain('data-testid="cost-unreported"')
    ticket = own
  })

  it('the Trust card shows the grade to everyone and its cost line only to an Admin', async () => {
    const admin = await html(cookie.admin)
    expect(admin).toMatch(/data-testid="trust-grade"/)
    expect(admin).toMatch(/data-testid="trust-cost"[^>]*>(<!-- -->)?<span[^>]*>\$(<!-- -->)?7\.31/)
    const member = await html(cookie.member)
    expect(member).toContain('data-testid="ticket-trust"')
    expect(member).not.toContain('data-testid="trust-cost"')
  })

  it('a non-Admin render carries no cost number', async () => {
    const out = await html(cookie.member)
    expect(out).not.toMatch(/\$7\.31|7\.3142/)
    expect(out).not.toContain('data-testid="ticket-cost"')
  })
})
