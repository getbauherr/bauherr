import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  APP,
  appModules,
  appSources,
  BAUHERR_ACTIONS,
  type Guard,
  notFound,
  OPEN_ACTIONS,
  partition,
  PO_ACTIONS,
  session,
  setupGuard,
  teardownGuard,
} from './helpers/product-owner-guard'

vi.mock('next/headers', async () => (await import('./helpers/product-owner-guard')).nextHeadersMock())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let guard: Guard
let productOwnerCookie: string

beforeAll(async () => {
  guard = await setupGuard('po_guard_actions')
  ;({ productOwnerCookie } = guard)
})

afterAll(async () => {
  await teardownGuard(guard)
})

describe('server actions', () => {
  const files = Object.keys(appModules)
    .filter((f) => /^\s*'use server'/.test(appSources[f] ?? ''))
    .sort()

  it('every action not listed is refused with a 404 for a Product owner', async () => {
    session.cookie = productOwnerCookie
    expect(files.length).toBe(17)
    let checked = 0
    for (const f of files) {
      const rel = f.slice((APP + '(app)/').length)
      for (const [name, fn] of Object.entries(await appModules[f]())) {
        if (typeof fn !== 'function' || `${rel}#${name}` in OPEN_ACTIONS) continue
        let outcome = 'ran'
        try {
          const r = (await (fn as (...a: unknown[]) => Promise<unknown>)(new FormData(), new FormData())) as
            { error?: string } | undefined
          outcome = r && typeof r === 'object' && 'error' in r ? `returned error ${r.error}` : 'ran'
        } catch (e) {
          outcome = notFound(e) ? '404' : `threw ${String(e)}`
        }
        expect(outcome, `${rel}#${name}`).toBe('404')
        checked++
      }
    }
    expect(checked).toBe(BAUHERR_ACTIONS.length)
  })

  it('the lists decide every action', async () => {
    const all: string[] = []
    for (const f of files)
      for (const [name, fn] of Object.entries(await appModules[f]()))
        if (typeof fn === 'function') all.push(`${f.slice((APP + '(app)/').length)}#${name}`)
    partition('actions', all, Object.keys(PO_ACTIONS), BAUHERR_ACTIONS)
  })

  it('OPEN_ACTIONS names real exports', async () => {
    for (const key of Object.keys(OPEN_ACTIONS)) {
      const [file, name] = key.split('#')
      expect(typeof (await appModules[`${APP}(app)/${file}`]())[name]).toBe('function')
    }
  })
})
