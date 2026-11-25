import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  APP,
  type Guard,
  nextHeadersMock,
  notFound,
  o,
  pageModules,
  routeModules,
  session,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let workspace: number
let own: number
let foreign: number

const idOf = async (collection: 'products' | 'workspaces', slug: string) =>
  Number((await guard.payload.find({ collection, where: { slug: { equals: slug } }, ...o })).docs[0]?.id)

beforeAll(async () => {
  guard = await setupGuard('request_new_guard')
  workspace = await idOf('workspaces', 'a')
  own = await idOf('products', 'a1')
  foreign = await idOf('products', 'a2')
}, 120_000)

afterAll(async () => {
  await teardownGuard(guard)
})

type Handler = (r: Request, c: unknown) => Promise<Response>

const create = async (product: number): Promise<Response> => {
  const route = await routeModules[`${APP}api/requests/route.ts`]()
  return (route.POST as Handler)(
    new Request('http://t/api/requests', {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ workspace, product }),
    }),
    {},
  )
}

const read = async (id: number): Promise<number> => {
  const route = await routeModules[`${APP}api/requests/[id]/route.ts`]()
  const request = new Request('http://t/api/requests/1', { headers: { cookie: session.cookie } })
  const res = await (route.GET as Handler)(request, { params: Promise.resolve({ id: String(id) }) })
  return res.status
}

const shown = async (product?: number): Promise<string> => {
  const page = await pageModules[`${APP}(app)/(shell)/requests/new/page.tsx`]()
  try {
    const tree = await page.default({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(product ? { product: String(product) } : {}),
    })
    return JSON.stringify(tree)
  } catch (error) {
    return notFound(error) ? '404' : `threw ${String(error)}`
  }
}

describe('a new request', () => {
  it('lets a Product owner start a draft for an assigned Product and read it back', async () => {
    session.cookie = guard.productOwnerCookie
    const res = await create(own)
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    expect(await read(id)).toBe(200)
  })

  it('answers 404 for a Product owner on a Product that is not assigned', async () => {
    session.cookie = guard.productOwnerCookie
    expect((await create(foreign)).status).toBe(404)
  })

  it('hides a draft of another Product from a Product owner', async () => {
    session.cookie = guard.bauherrCookie
    const { id } = (await (await create(foreign)).json()) as { id: number }
    session.cookie = guard.productOwnerCookie
    expect(await read(id)).toBe(404)
  })

  it('still works for a Bauherr of the Workspace', async () => {
    session.cookie = guard.bauherrCookie
    expect((await create(own)).status).toBe(201)
    expect((await create(foreign)).status).toBe(201)
  })

  it('opens the screen for a Product owner with the assigned Product only', async () => {
    session.cookie = guard.productOwnerCookie
    const html = await shown(foreign)
    expect(html).not.toBe('404')
    expect(html).not.toContain('threw')
    expect(html).toContain('a1')
    expect(html).not.toContain('a2')
  })

  it('opens the screen for a Bauherr with every Product', async () => {
    session.cookie = guard.bauherrCookie
    const html = await shown()
    expect(html).toContain('a1')
    expect(html).toContain('a2')
  })
})
