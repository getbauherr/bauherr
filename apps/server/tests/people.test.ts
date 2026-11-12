import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { roleFrom, syncFrom } from '../src/lib/oidc'
import { assignmentOf, assignmentWords, canSeeProduct, homeOf, isBauherr, isProductOwner, mediaVisibleTo, productScope, productsVisibleTo, rank, requestsVisibleTo, resyncRole } from '../src/lib/people'
import { createTestDb, type TestDb } from './helpers/test-db'

const owner = (assignments: unknown[]) => ({ role: 'product-owner', assignments })

describe('rank and roles', () => {
  it('orders admin > bauherr > product-owner and refuses anything else', () => {
    expect([rank({ role: 'admin' }), rank({ role: 'bauherr' }), rank({ role: 'product-owner' }), rank({ role: 'x' }), rank(null)]).toEqual([3, 2, 1, 0, 0])
    expect([{ role: 'admin' }, { role: 'bauherr' }, { role: 'product-owner' }, { role: 'x' }, null].map(isBauherr)).toEqual([true, true, false, false, false])
    expect([isProductOwner({ role: 'product-owner' }), isProductOwner({ role: 'bauherr' })]).toEqual([true, false])
    expect([homeOf({ role: 'product-owner' }), homeOf({ role: 'admin' })]).toEqual(['/requests', '/'])
  })
})

describe('assignments', () => {
  it('reads scope and products per Workspace; an empty list under products grants nothing', () => {
    const u = owner([{ workspace: 1, scope: 'workspace', products: [] }, { workspace: { id: 2 }, scope: 'products', products: [{ id: 7 }, 8] }, { workspace: 3, scope: 'products', products: [] }])
    expect(assignmentOf(u, 1)).toEqual({ scope: 'workspace' })
    expect(assignmentOf(u, 2)).toEqual({ scope: 'products', products: [7, 8] })
    expect(assignmentOf(u, 3)).toEqual({ scope: 'products', products: [] })
    expect(assignmentOf(u, 4)).toBeNull()
    expect(assignmentOf({ role: 'bauherr', assignments: u.assignments }, 1)).toBeNull()
    expect([7, 8, 9].map((id) => canSeeProduct(u, { id, workspace: 2 }))).toEqual([true, true, false])
    expect(canSeeProduct(u, { id: 1, workspace: 1 })).toBe(true)
    expect(canSeeProduct(u, { id: 1, workspace: 3 })).toBe(false)
    expect(canSeeProduct(u, { id: 1, workspace: 4 })).toBe(false)
  })

  it('a Bauherr sees every Product of their Workspaces, an Admin all', () => {
    const b = { role: 'bauherr', tenants: [{ tenant: 1 }, { tenant: { id: 2 } }] }
    expect([1, 2, 3].map((workspace) => canSeeProduct(b, { id: 5, workspace }))).toEqual([true, true, false])
    expect(canSeeProduct({ role: 'admin' }, { id: 5, workspace: 99 })).toBe(true)
    expect(canSeeProduct({ role: 'nobody' }, { id: 5, workspace: 1 })).toBe(false)
  })

  it('words for the People table', () => {
    expect(assignmentWords([{ workspace: 'Acme', scope: 'workspace', products: [] }])).toBe('All Products of Acme')
    expect(assignmentWords([{ workspace: 'Acme', scope: 'products', products: ['Acme Shop', 'Acme Web'] }])).toBe('Acme Shop, Acme Web')
    expect(assignmentWords([{ workspace: 'Acme', scope: 'products', products: [] }])).toBe('No Products in Acme')
    expect(assignmentWords([])).toBe('Nothing assigned')
  })
})

describe('what a person sees of a Workspace (the one filter)', () => {
  const none = { equals: -1 }
  const po = { id: 9, ...owner([{ workspace: 1, scope: 'products', products: [{ id: 7 }, 8] }, { workspace: 2, scope: 'workspace' }, { workspace: 3, scope: 'products', products: [] }]) }
  const bauherr = { id: 1, role: 'bauherr', tenants: [{ tenant: 1 }] }

  it('productScope: a Bauherr or Admin the Workspace, a Product owner the assigned Products, nobody else nothing', () => {
    expect(productScope(bauherr, 1)).toEqual({ 'product.workspace': { equals: 1 } })
    expect(productScope({ role: 'admin' }, 5, 'ticket.product')).toEqual({ 'ticket.product.workspace': { equals: 5 } })
    expect(productScope(po, 1)).toEqual({ product: { in: [7, 8] } })
    expect(productScope(po, 2)).toEqual({ 'product.workspace': { equals: 2 } })
    expect(productScope(po, 3)).toEqual({ product: none })
    expect(productScope(po, 4)).toEqual({ product: none })
    expect(productScope({ role: 'nobody' }, 1)).toEqual({ product: none })
  })

  it('productsVisibleTo narrows the products collection the same way', () => {
    expect(productsVisibleTo(bauherr, 1)).toEqual({ and: [{ workspace: { equals: 1 } }] })
    expect(productsVisibleTo(po, 1)).toEqual({ and: [{ workspace: { equals: 1 } }, { id: { in: [7, 8] } }] })
    expect(productsVisibleTo(po, 2)).toEqual({ and: [{ workspace: { equals: 2 } }] })
    expect(productsVisibleTo(po, 3)).toEqual({ and: [{ workspace: { equals: 3 } }, { id: none }] })
  })

  it('requestsVisibleTo: a Bauherr every request, a Product owner the sent requests of their Products and their own drafts', () => {
    expect(requestsVisibleTo(bauherr, 1)).toEqual({ and: [{ 'product.workspace': { equals: 1 } }] })
    expect(requestsVisibleTo(po, 1)).toEqual({ and: [{ product: { in: [7, 8] } }, { or: [{ status: { equals: 'submitted' } }, { user: { equals: 9 } }] }] })
    expect(requestsVisibleTo(po, 3)).toEqual({ and: [{ product: none }, { or: [{ status: { equals: 'submitted' } }, { user: { equals: 9 } }] }] })
  })

  it('mediaVisibleTo: files of an assigned Product only, a draft\'s files only to its author', () => {
    const comment = (product: number) => ({ id: 1, product, workspace: 1 })
    expect([7, 8, 6].map((p) => mediaVisibleTo(po, comment(p)))).toEqual([true, true, false])
    expect(mediaVisibleTo(po, { id: 1, product: 7, workspace: 3 })).toBe(false)
    expect(mediaVisibleTo(po, { id: 1, workspace: 1 })).toBe(false)
    const shot = (status: string, user: number) => ({ id: 2, session: { workspace: 1, product: 7, status, user } })
    expect([mediaVisibleTo(po, shot('submitted', 4)), mediaVisibleTo(po, shot('open', 9)), mediaVisibleTo(po, shot('open', 4))]).toEqual([true, true, false])
    expect(mediaVisibleTo(bauherr, shot('open', 4))).toBe(true)
  })
})

describe('OIDC roles', () => {
  const claims = { realm_access: { roles: ['po-role'] } }
  it('maps the Product owner claim only when configured, the admin claim wins', () => {
    expect(roleFrom(claims, 'realm_access.roles', 'bauherr-admin', 'po-role')).toBe('product-owner')
    expect(roleFrom(claims, 'realm_access.roles', 'bauherr-admin', undefined)).toBe('bauherr')
    expect(roleFrom({ realm_access: { roles: ['po-role', 'bauherr-admin'] } }, 'realm_access.roles', 'bauherr-admin', 'po-role')).toBe('admin')
    expect(syncFrom({ other: 1 })).toEqual({})
  })
  it('a re-sync never raises a Product owner to bauherr, but follows an admin or Product owner claim', () => {
    expect(resyncRole('product-owner', 'bauherr')).toBe('product-owner')
    expect(resyncRole('product-owner', 'admin')).toBe('admin')
    expect(resyncRole('bauherr', 'product-owner')).toBe('product-owner')
    expect(resyncRole('admin', 'bauherr')).toBe('bauherr')
    expect(resyncRole(undefined, 'bauherr')).toBe('bauherr')
  })
})

describe('account hooks', () => {
  let payload: Payload
  let testDb: TestDb
  const o = { overrideAccess: true, depth: 0 } as const
  let a: number
  let b: number
  let a1: number
  let a2: number
  let b1: number
  const mk = (email: string, data: Record<string, unknown>) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', ...data } as never, ...o })
  const get = (id: number | string) => payload.findByID({ collection: 'bauherren', id, ...o }) as Promise<Record<string, any>>

  beforeAll(async () => {
    testDb = await createTestDb('people')
    process.env.DATABASE_URL = testDb.url
    process.env.PAYLOAD_SECRET ??= 'test-secret'
    process.env.ENCRYPTION_KEY ??= 'test-key'
    delete process.env.GATEWAY_ADMIN_URL
    const { getPayload } = await import('payload')
    payload = await getPayload({ config: (await import('../src/payload.config')).default })
    ;[a, b] = await Promise.all(['a', 'b'].map(async (slug) => (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id as number))
    ;[a1, a2, b1] = await Promise.all([['a1', a], ['a2', a], ['b1', b]].map(async ([slug, workspace]) => (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id as number))
    await mk('admin@x.io', { role: 'admin' })
  })
  afterAll(async () => {
    await payload?.destroy()
    await testDb?.drop(payload)
  })

  it('the first account becomes Admin even when asked to be a Product owner', async () => {
    expect(await payload.count({ collection: 'bauherren', ...o })).toMatchObject({ totalDocs: 1 })
    const first = await get((await payload.find({ collection: 'bauherren', limit: 1, ...o })).docs[0]!.id)
    expect(first.role).toBe('admin')
  })

  it('keeps tenants equal to the Workspaces of the assignments, whatever the caller sends', async () => {
    const u = await mk('po1@x.io', { role: 'product-owner', tenants: [{ tenant: b }], assignments: [{ workspace: a, scope: 'products', products: [a1] }] })
    expect((await get(u.id)).tenants.map((t: { tenant: number }) => t.tenant)).toEqual([a])
    await payload.update({ collection: 'bauherren', id: u.id, data: { assignments: [{ workspace: a, scope: 'workspace' }, { workspace: b, scope: 'products', products: [b1] }] } as never, ...o })
    const after = await get(u.id)
    expect(after.tenants.map((t: { tenant: number }) => t.tenant)).toEqual([a, b])
    expect(after.assignments.map((r: { scope: string; products: number[] }) => [r.scope, r.products])).toEqual([['workspace', []], ['products', [b1]]])
    await payload.update({ collection: 'bauherren', id: u.id, data: { tenants: [{ tenant: a }, { tenant: b }, { tenant: a }] }, ...o })
    expect((await get(u.id)).tenants.map((t: { tenant: number }) => t.tenant)).toEqual([a, b])
  })

  it('a new SSO product owner has no assignment and so no Workspace', async () => {
    const u = await payload.create({ collection: 'bauherren', data: { email: 'sso@x.io', password: 'pw-123456', role: 'product-owner', tenants: [{ tenant: a }] } as never, context: { oidc: true }, ...o })
    expect((await get(u.id)).tenants).toEqual([])
  })

  it('refuses a Product of another Workspace and two assignments for one Workspace', async () => {
    await expect(mk('bad1@x.io', { role: 'product-owner', assignments: [{ workspace: a, scope: 'products', products: [b1] }] })).rejects.toThrow()
    await expect(mk('bad2@x.io', { role: 'product-owner', assignments: [{ workspace: a, scope: 'workspace' }, { workspace: a, scope: 'products', products: [a1] }] })).rejects.toThrow()
    await expect(mk('bad3@x.io', { role: 'bauherr', assignments: [{ workspace: a, scope: 'workspace' }] })).rejects.toThrow()
  })

  it('deleting a Product removes it from the assignments; an emptied list grants nothing', async () => {
    const u = await mk('po2@x.io', { role: 'product-owner', assignments: [{ workspace: a, scope: 'products', products: [a1, a2] }] })
    await payload.delete({ collection: 'products', id: a1, ...o })
    expect((await get(u.id)).assignments[0]).toMatchObject({ scope: 'products', products: [a2] })
    await payload.delete({ collection: 'products', id: a2, ...o })
    const after = await get(u.id)
    expect(after.assignments[0]).toMatchObject({ scope: 'products', products: [] })
    expect(assignmentOf(after, a)).toEqual({ scope: 'products', products: [] })
  })

  it('changing the role away from Product owner clears the assignments; to Product owner gives no API key', async () => {
    const [w] = [(await payload.create({ collection: 'products', data: { name: 'x', slug: 'x', workspace: a }, ...o })).id as number]
    const u = await mk('po3@x.io', { role: 'product-owner', assignments: [{ workspace: a, scope: 'products', products: [w] }] })
    await payload.update({ collection: 'bauherren', id: u.id, data: { role: 'bauherr' }, ...o })
    expect(await get(u.id)).toMatchObject({ role: 'bauherr', assignments: [] })
    const keyed = await mk('keyed@x.io', { role: 'bauherr', enableAPIKey: true, apiKey: 'k'.repeat(32) })
    await payload.update({ collection: 'bauherren', id: keyed.id, data: { role: 'product-owner' }, ...o })
    expect(await get(keyed.id)).toMatchObject({ role: 'product-owner', enableAPIKey: false, tenants: [] })
  })
  it('concurrent writers never put an account back: one of two racing writes is refused and the stored account is exactly the winner, never a mix', async () => {
    const w = (await payload.create({ collection: 'products', data: { name: 'r', slug: 'r', workspace: a }, ...o })).id as number
    const race = (id: number | string, first: Record<string, unknown>, second: Record<string, unknown>) =>
      Promise.all([first, second].map((data) => payload.update({ collection: 'bauherren', id, data: data as never, ...o }).then(() => null, (e: Error) => e)))
    for (let i = 0; i < 20; i++) {
      const u = await mk(`race-down-${i}@x.io`, { role: 'product-owner', assignments: [{ workspace: a, scope: 'products', products: [w] }] })
      const [assign, role] = await race(u.id, { assignments: [{ workspace: a, scope: 'workspace' }] }, { role: 'bauherr' })
      expect([assign === null, role === null].sort(), `iteration ${i}: exactly one write is refused`).toEqual([false, true])
      expect(await get(u.id), `iteration ${i}`).toMatchObject(role === null ? { role: 'bauherr', assignments: [] } : { role: 'product-owner', assignments: [{ scope: 'workspace' }] })
    }
    for (let i = 0; i < 20; i++) {
      const u = await mk(`race-up-${i}@x.io`, { role: 'bauherr', tenants: [{ tenant: a }] })
      const [role, login] = await race(u.id, { role: 'product-owner' }, { githubLogin: 'stale' })
      expect([role === null, login === null].sort(), `iteration ${i}: exactly one write is refused`).toEqual([false, true])
      expect(await get(u.id), `iteration ${i}`).toMatchObject(role === null ? { role: 'product-owner', tenants: [], githubLogin: null } : { role: 'bauherr', githubLogin: 'stale' })
    }
  })
})
