import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BAUHERR_ROUTES, OPEN_ROUTES, PO_ROUTES } from './helpers/guard-lists'
import {
  APP,
  type Guard,
  partition,
  routeModules,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => (await import('./helpers/product-owner-guard')).nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let productOwnerCookie: string

beforeAll(async () => {
  guard = await setupGuard('po_guard_routes')
  ;({ productOwnerCookie } = guard)
})

afterAll(async () => {
  await teardownGuard(guard)
})

describe('routes', () => {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  const routes = Object.keys(routeModules).map((f) => ({
    file: f,
    route: f
      .slice(APP.length)
      .replace(/\/route\.ts$/, '')
      .replace(/\((?:app|shell)\)\/?/g, ''),
  }))

  it('every route handler not listed refuses a Product owner with 401, 403 or 404', async () => {
    const seen: string[] = []
    for (const { file, route } of routes) {
      const mod = await routeModules[file]()
      const url = `http://t/${route.replace(/\[[^\]]+\]/g, '1')}`
      for (const method of METHODS.filter((m) => typeof mod[m] === 'function')) {
        const key = `${route} ${method}`
        seen.push(key)
        if (key in OPEN_ROUTES) continue
        const read = method === 'GET' || method === 'HEAD'
        const init: RequestInit = {
          method,
          headers: { cookie: productOwnerCookie, ...(read ? {} : { 'content-type': 'application/json' }) },
          ...(read ? {} : { body: '{}' }),
        }
        const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(url, init), {
          params: Promise.resolve({ id: '1', slug: 'a', sig: 'x', path: [] }),
        })
        expect(method === 'OPTIONS' ? [204] : [401, 403, 404], key).toContain(res.status)
      }
    }
    for (const key of Object.keys(OPEN_ROUTES))
      expect(seen, `OPEN_ROUTES names a route that does not exist: ${key}`).toContain(key)
    expect(seen.length).toBe(22)
    partition('routes', seen, Object.keys(PO_ROUTES), BAUHERR_ROUTES)
  })
})
