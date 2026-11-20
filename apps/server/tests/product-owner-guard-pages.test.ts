import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  APP,
  BAUHERR_PAGES,
  type Guard,
  notFound,
  OPEN_PAGES,
  pageModules,
  partition,
  PO_PAGES,
  session,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => (await import('./helpers/product-owner-guard')).nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let productOwnerCookie: string
let bauherrCookie: string

beforeAll(async () => {
  guard = await setupGuard('po_guard_pages')
  ;({ productOwnerCookie, bauherrCookie } = guard)
})

afterAll(async () => {
  await teardownGuard(guard)
})

describe('pages', () => {
  const pages = Object.keys(pageModules).map((f) => ({
    file: f,
    route: f
      .slice((APP + '(app)/').length)
      .replace(/\/?page\.tsx$/, '')
      .replace(/^\(shell\)\/?/, ''),
  }))

  it('the list below decides every page', () => {
    expect(pages.length).toBeGreaterThanOrEqual(14)
    partition(
      'pages',
      pages.map((p) => p.route),
      Object.keys(PO_PAGES),
      BAUHERR_PAGES,
    )
    for (const p of Object.keys(OPEN_PAGES))
      expect(
        pages.map((x) => x.route),
        `OPEN_PAGES names a page that does not exist: ${p}`,
      ).toContain(p)
  })

  it('every page not listed answers a Product owner with a 404 when rendered', async () => {
    session.cookie = productOwnerCookie
    const params = Promise.resolve({ id: '1', number: '1', name: 'x' })
    for (const { file, route } of pages.filter((p) => !(p.route in OPEN_PAGES))) {
      let outcome = 'rendered'
      try {
        await (await pageModules[file]()).default({ params, searchParams: Promise.resolve({}) })
      } catch (e) {
        outcome = notFound(e) ? '404' : `threw ${String(e)}`
      }
      expect(outcome, `page /${route}`).toBe('404')
    }
  })

  it('the same render as a Bauherr is not a 404 (control for the harness)', async () => {
    session.cookie = bauherrCookie
    const page = await pageModules[`${APP}(app)/(shell)/settings/products/page.tsx`]()
    await expect(page.default({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
    session.cookie = productOwnerCookie
  })
})
