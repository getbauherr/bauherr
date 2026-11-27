import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecord } from '../src/core/record/store'
import { source } from './core/fixtures'
import { jar } from './helpers/cookie-jar'
import {
  APP,
  type Guard,
  notFound,
  o,
  pageModules,
  routeModules,
  session,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => (await import('./helpers/product-owner-guard')).nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

type Handler = (r: Request, c: unknown) => Promise<Response>

let guard: Guard
let workspace: number
let REQUEST_PRODUCT_COOKIE = ''
let adminCookie = ''
const products = { own: 0, other: 0 }
const records = { own: 0, other: 0 }
const NUMBERS = { own: 601, other: 602 }

const idOf = async (collection: 'products' | 'workspaces', slug: string) =>
  Number((await guard.payload.find({ collection, where: { slug: { equals: slug } }, ...o })).docs[0]?.id)

const record = async (product: number, number: number) =>
  (await createRecord(guard.payload, { workspace, product, source: { ...source, number }, type: 'change' })).id

beforeAll(async () => {
  guard = await setupGuard('requests_bauherr_access')
  ;({ REQUEST_PRODUCT_COOKIE } = await import('../src/app/(app)/lib/requests'))
  const where = { role: { equals: 'admin' } } as const
  const admin = (await guard.payload.find({ collection: 'bauherren', where, ...o })).docs[0]
  const { signSession } = await import('../src/lib/oidc-session')
  adminCookie = `bauherr-session=${signSession(Number(admin?.id), 0)}`
  workspace = await idOf('workspaces', 'a')
  products.own = await idOf('products', 'a1')
  products.other = await idOf('products', 'a2')
  records.own = await record(products.own, NUMBERS.own)
  records.other = await record(products.other, NUMBERS.other)
}, 120_000)

afterAll(async () => {
  await teardownGuard(guard)
})

beforeEach(() => {
  jar.clear()
})

const ROLES = ['bauherr', 'admin', 'product-owner'] as const
type Role = (typeof ROLES)[number]
const cookieOf = (role: Role) =>
  ({ bauherr: guard.bauherrCookie, admin: adminCookie, 'product-owner': guard.productOwnerCookie })[role]
const staff = (role: Role) => role !== 'product-owner'

const render = async (path: string, props: object): Promise<string> => {
  const page = await pageModules[`${APP}(app)/(shell)/${path}/page.tsx`]()
  try {
    return JSON.stringify(await page.default(props), (key, value: unknown) =>
      key === 'type' && typeof value !== 'string' ? undefined : value,
    )
  } catch (error) {
    return notFound(error) ? '404' : `threw ${String(error)}`
  }
}

const list = (query: { product?: string } = {}) => render('requests', { searchParams: Promise.resolve(query) })
const open = (id: number) => render('requests/[id]', { params: Promise.resolve({ id: String(id) }) })

const start = async (product: number): Promise<number> => {
  const route = await routeModules[`${APP}api/requests/route.ts`]()
  const request = new Request('http://t/api/requests', {
    method: 'POST',
    headers: { cookie: session.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ workspace, product }),
  })
  return (await (route.POST as Handler)(request, {})).status
}

const shows = (html: string) => ({
  own: html.includes(`"number":${NUMBERS.own}`),
  other: html.includes(`"number":${NUMBERS.other}`),
})

describe('the access matrix of Requests', () => {
  it.each(ROLES)('%s: lists, opens and starts requests for the Products they may', async (role) => {
    session.cookie = cookieOf(role)
    const mayOther = staff(role)
    expect(shows(await list({ product: String(products.own) }))).toEqual({ own: true, other: false })
    expect(shows(await list({ product: String(products.other) }))).toEqual(
      mayOther ? { own: false, other: true } : { own: true, other: false },
    )
    expect(await open(records.own)).not.toMatch(/^(404|threw)/)
    expect(await open(records.other)).toMatch(mayOther ? /^(?!404|threw)/ : /^404$/)
    expect(await start(products.own)).toBe(201)
    expect(await start(products.other)).toBe(mayOther ? 201 : 404)
  })

  it('opens the new request screen for staff on any Product and for a Product owner on theirs only', async () => {
    const screen = (product: number) =>
      render('requests/new', { searchParams: Promise.resolve({ product: String(product) }) })
    session.cookie = adminCookie
    expect(await screen(products.other)).toContain(`"product":${products.other}`)
    session.cookie = guard.bauherrCookie
    expect(await screen(products.other)).toContain(`"product":${products.other}`)
    session.cookie = guard.productOwnerCookie
    const owner = await screen(products.other)
    expect(owner).toContain(`"product":${products.own}`)
    expect(owner).not.toContain('"name":"a2"')
  })
})

describe('the Product switcher on Requests', () => {
  it('offers staff every Product of the Workspace and a Product owner only their own', async () => {
    session.cookie = guard.bauherrCookie
    const staffHtml = await list()
    expect(staffHtml).toContain('"name":"a1"')
    expect(staffHtml).toContain('"name":"a2"')
    session.cookie = guard.productOwnerCookie
    const owner = await list()
    expect(owner).toContain('"name":"a1"')
    expect(owner).not.toContain('"name":"a2"')
  })

  it('starts with the first Product, then with the last one used', async () => {
    session.cookie = guard.bauherrCookie
    expect(shows(await list())).toEqual({ own: true, other: false })
    jar.set(REQUEST_PRODUCT_COOKIE, String(products.other))
    expect(shows(await list())).toEqual({ own: false, other: true })
    expect(shows(await list({ product: String(products.own) }))).toEqual({ own: true, other: false })
  })

  it('ignores a remembered Product a Product owner may not read', async () => {
    session.cookie = guard.productOwnerCookie
    jar.set(REQUEST_PRODUCT_COOKIE, String(products.other))
    expect(shows(await list())).toEqual({ own: true, other: false })
  })

  it('remembers a chosen Product for staff and refuses a Product a Product owner may not read', async () => {
    const actions = await import('../src/app/(app)/(shell)/requests/actions')
    const outcome = async (product: number) => {
      try {
        await actions.chooseRequestProduct(product)
        return 'returned'
      } catch (error) {
        return notFound(error) ? '404' : /NEXT_REDIRECT/.test(String(error)) ? 'redirect' : `threw ${String(error)}`
      }
    }
    session.cookie = guard.productOwnerCookie
    expect(await outcome(products.other)).toBe('404')
    expect(jar.has(REQUEST_PRODUCT_COOKIE)).toBe(false)
    session.cookie = guard.bauherrCookie
    expect(await outcome(products.other)).toBe('redirect')
    expect(jar.get(REQUEST_PRODUCT_COOKIE)).toBe(String(products.other))
  })
})
