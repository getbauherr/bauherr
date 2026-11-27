import type { Payload, User } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BAUHERR_COLLECTIONS, COLLECTIONS, PO_COLLECTIONS } from './helpers/guard-lists'
import {
  type Guard,
  o,
  PASSWORD,
  stringsOf,
  partition,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => (await import('./helpers/product-owner-guard')).nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let payload: Payload
let po: User
let bauherr: User
let productOwnerCookie: string

beforeAll(async () => {
  guard = await setupGuard('po_guard_collections')
  ;({ payload, po, bauherr, productOwnerCookie } = guard)
})

afterAll(async () => {
  await teardownGuard(guard)
})

describe('collections', () => {
  const own = (data: Record<string, unknown>) =>
    payload.update({ collection: 'bauherren', id: po.id, data, user: po, overrideAccess: false, depth: 0 })

  it('the list below decides every collection', () => {
    partition(
      'collections',
      payload.config.collections.map((c) => c.slug),
      Object.keys(PO_COLLECTIONS),
      BAUHERR_COLLECTIONS,
    )
  })

  it('a Product owner is refused every operation not listed as open (local API, access control on)', async () => {
    const as = { user: po, overrideAccess: false }
    const refused = async (run: () => Promise<unknown>) => {
      try {
        await run()
        return false
      } catch (e) {
        return (e as Error).name === 'Forbidden' || /not allowed|forbidden/i.test((e as Error).message)
      }
    }
    for (const [collection, rule] of Object.entries(COLLECTIONS)) {
      const open = rule === 'closed' ? {} : rule
      const ops: Record<string, () => Promise<unknown>> = {
        read: () => payload.find({ collection, ...as }),
        create: () => payload.create({ collection, data: {}, ...as }),
        update: () => payload.update({ collection, id: 1, data: {}, ...as }),
        delete: () => payload.delete({ collection, id: 1, ...as }),
      }
      for (const [op, run] of Object.entries(ops))
        if (!(op in open))
          expect(await refused(run), `${collection}.${op} must be refused for a Product owner`).toBe(true)
    }
  })

  it('Payload REST answers a Product owner 403 on every closed collection', async () => {
    const { GET } = await import('../src/app/(payload)/api/[...slug]/route')
    for (const [collection, rule] of Object.entries(COLLECTIONS)) {
      if (rule !== 'closed' || collection.startsWith('payload-')) continue
      const res = await GET(new Request(`http://t/api/${collection}`, { headers: { cookie: productOwnerCookie } }), {
        params: Promise.resolve({ slug: [collection] }),
      })
      expect([401, 403], `GET /api/${collection}`).toContain(res.status)
    }
    const { GET: get2 } = await import('../src/app/(payload)/api/[...slug]/route')
    const own = await get2(new Request('http://t/api/bauherren', { headers: { cookie: productOwnerCookie } }), {
      params: Promise.resolve({ slug: ['bauherren'] }),
    })
    expect(((await own.json()) as { docs: { email: string }[] }).docs.map((d) => d.email)).toEqual(['owner@x.io'])
  })

  it('a Product owner reads only their own account and cannot open the admin UI', async () => {
    const { docs } = await payload.find({ collection: 'bauherren', user: po, overrideAccess: false })
    expect(stringsOf(docs, 'email')).toEqual(['owner@x.io'])
    const adminAccess = payload.collections.bauherren.config.access.admin as (a: unknown) => boolean
    expect(adminAccess({ req: { user: po } })).toBe(false)
  })

  it('a Product owner can change their password, preferences and ' +
    'forge login, nothing else on the account', async () => {
    await expect(own({ uiPrefs: { epic: 3 } })).resolves.toMatchObject({ uiPrefs: { epic: 3 } })
    await expect(own({ password: `${PASSWORD}-new` })).resolves.toBeTruthy()
    const before = await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })
    for (const data of [
      { role: 'bauherr' },
      { role: 'admin' },
      { tenants: [] },
      { assignments: [] },
      { enableAPIKey: true },
      { apiKey: 'x'.repeat(32) },
      { oidcSubject: 'x|y' },
      { email: 'other@x.io' },
    ]) {
      await own(data).catch(() => undefined)
      const after = await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })
      for (const k of ['role', 'tenants', 'assignments', 'enableAPIKey', 'oidcSubject', 'email'] as const)
        expect(after[k] ?? null, `${JSON.stringify(data)} changed ${k}`).toEqual(before[k] ?? null)
    }
    expect(before).toMatchObject({ role: 'product-owner' })
  })

  it('a Product owner links their own forge login, and cannot take ' +
    'one another account holds, whatever its case', async () => {
    await payload.update({ collection: 'bauherren', id: guard.bauherrId, data: { githubLogin: 'Taken-Login' }, ...o })
    await expect(own({ githubLogin: 'taken-login' })).rejects.toThrow()
    await expect(own({ githubLogin: 'po-login' })).resolves.toMatchObject({ githubLogin: 'po-login' })
    await expect(own({ githubLogin: null })).resolves.toMatchObject({ githubLogin: null })
  })

  it('an Admin cannot give a Product owner an API key either', async () => {
    await expect(
      payload.update({
        collection: 'bauherren',
        id: po.id,
        data: { enableAPIKey: true, apiKey: 'k'.repeat(32) },
        ...o,
      }),
    ).rejects.toThrow()
  })

  it('a Bauherr still reads their own Workspace and nothing of another (control for the harness)', async () => {
    const as = { user: bauherr, overrideAccess: false }
    expect(stringsOf((await payload.find({ collection: 'products', ...as })).docs, 'slug').sort()).toEqual(['a1', 'a2'])
    expect(stringsOf((await payload.find({ collection: 'workspaces', ...as })).docs, 'slug')).toEqual(['a'])
  })
})
