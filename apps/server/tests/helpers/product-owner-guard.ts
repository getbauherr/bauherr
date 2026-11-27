import type { Payload, User } from 'payload'
import { expect } from 'vitest'
import { z } from 'zod'
import { cookiesMock } from './cookie-jar'
import { createTestDb, type TestDb } from './test-db'

export const partition = (what: string, all: string[], po: string[], bauherr: string[]) => {
  expect(new Set([...po, ...bauherr]).size, `${what}: an entry is in both lists or twice`).toBe(
    po.length + bauherr.length,
  )
  expect([...po, ...bauherr].sort(), `${what}: every one is in exactly one list`).toEqual([...all].sort())
}

export const stringsOf = (docs: unknown, key: string): string[] =>
  z.array(z.record(z.string(), z.unknown())).parse(docs).map((d) => z.string().parse(d[key]))

export const session = { cookie: '' }

export const nextHeadersMock = () => ({
  headers: async () => new Headers({ cookie: session.cookie }),
  cookies: cookiesMock,
})

export const o = { overrideAccess: true } as const
export const PASSWORD = 'pw-123456-guard'

export const notFound = (e: unknown) => /404|NEXT_NOT_FOUND/.test(String((e as { digest?: string })?.digest ?? e))

export type Guard = {
  payload: Payload
  testDb: TestDb
  po: User
  bauherr: User
  bauherrId: number
  productOwnerCookie: string
  bauherrCookie: string
}

const asUser = async (payload: Payload, cookie: string): Promise<User> => {
  const { user } = await payload.auth({ headers: new Headers({ cookie }) })
  if (!user) throw new Error('the session cookie does not sign in')
  return user
}

export const setupGuard = async (suite: string): Promise<Guard> => {
  const testDb = await createTestDb(suite)
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.MEDIA_DIR = `/tmp/bauherr-${suite}-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  const { signSession } = await import('../../src/lib/oidc-session')
  await payload.create({
    collection: 'bauherren',
    data: { email: 'admin@x.io', password: PASSWORD, role: 'admin' },
    ...o,
  })
  const [a, b] = await Promise.all(
    ['a', 'b'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })),
  )
  const a1 = await payload.create({ collection: 'products', data: { name: 'a1', slug: 'a1', workspace: a.id }, ...o })
  await payload.create({ collection: 'products', data: { name: 'b1', slug: 'b1', workspace: b.id }, ...o })
  await payload.create({ collection: 'products', data: { name: 'a2', slug: 'a2', workspace: a.id }, ...o })
  const mkBauherr = await payload.create({
    collection: 'bauherren',
    data: { email: 'member@x.io', password: PASSWORD, role: 'bauherr', tenants: [{ tenant: a.id }] },
    ...o,
  })
  const mkPo = await payload.create({
    collection: 'bauherren',
    data: {
      email: 'owner@x.io',
      password: PASSWORD,
      role: 'product-owner',
      assignments: [{ workspace: a.id, scope: 'products', products: [a1.id] }],
    },
    ...o,
  })
  const bauherrCookie = `bauherr-session=${signSession(mkBauherr.id, 0)}`
  const productOwnerCookie = `bauherr-session=${signSession(mkPo.id, 0)}`
  session.cookie = productOwnerCookie
  return {
    payload,
    testDb,
    po: await asUser(payload, productOwnerCookie),
    bauherr: await asUser(payload, bauherrCookie),
    bauherrId: mkBauherr.id as number,
    productOwnerCookie,
    bauherrCookie,
  }
}

export const teardownGuard = async (guard: Guard | undefined) => {
  await guard?.payload.destroy()
  await guard?.testDb.drop(guard.payload)
}

export const APP = '../../src/app/'
const only = <T>(all: Record<string, T>, keep: (f: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(all).filter(([f]) => keep(f)))
export const pageModules = only(import.meta.glob('../../src/app/**/page.tsx'), (f) => f.includes('/(app)/')) as Record<
  string,
  () => Promise<{ default: (p: unknown) => Promise<unknown> }>
>
export const routeModules = only(
  import.meta.glob('../../src/app/**/route.ts'),
  (f) => !f.includes('/(payload)/'),
) as Record<string, () => Promise<Record<string, unknown>>>
export const appModules = only(import.meta.glob('../../src/app/**/*.{ts,tsx}'), (f) => f.includes('/(app)/')) as Record<
  string,
  () => Promise<Record<string, unknown>>
>
export const appSources = only(
  import.meta.glob<string>('../../src/app/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  (f) => f.includes('/(app)/'),
)
