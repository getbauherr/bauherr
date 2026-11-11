import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/**
 * Closed by default: everything a Product owner could reach is enumerated and refused unless it is listed here, with the reason.
 * Adding a page, route, server action, MCP tool or collection fails this file until it is decided: to open something to a Product owner
 * add it to the matching allow-list below (and to docs/spec/people.md), never loosen an existing rule to make this pass.
 */

/** Page routes (relative to src/app/(app), without `/page.tsx`) a Product owner may open. */
const OPEN_PAGES: Record<string, string> = {
  login: 'public sign-in; a signed-in account is sent to its home',
  settings: 'redirects to the profile',
  'settings/profile': 'the profile and the minimal shell sentence',
}
/** Route handlers (relative to src/app, `<path> <METHOD>`) that answer a Product owner's session like anyone else's. */
const OPEN_ROUTES: Record<string, string> = {
  'api/health GET': 'unauthenticated health probe',
  'auth/oidc/login GET': 'sign-in flow',
  'auth/oidc/callback GET': 'sign-in flow',
  'm/[id]/[sig] GET': 'public, signed image link for forge issues; the session is not read',
}
/** Exported server actions (`<file>#<name>`, file relative to src/app/(app)) a Product owner may call. */
const OPEN_ACTIONS: Record<string, string> = {
  'lib/actions.ts#login': 'sign-in',
  'lib/actions.ts#logout': 'sign-out',
}
/** MCP tools a Product owner may call. */
const OPEN_TOOLS: Record<string, string> = {}
/** Every collection and what a Product owner may do with it; `closed` = nothing, an object lists the open operations. */
const COLLECTIONS: Record<string, 'closed' | Record<string, string>> = {
  bauherren: { read: 'own account only', update: 'own account: uiPrefs and password only' },
  agent_keys: 'closed',
  artifacts: 'closed',
  workspaces: 'closed',
  products: 'closed',
  connections: 'closed',
  repositories: 'closed',
  ticket_sources: 'closed',
  tickets: 'closed',
  runs: 'closed',
  steps: 'closed',
  tool_calls: 'closed',
  human_touches: 'closed',
  skill_proposals: 'closed',
  templates: 'closed',
  check_flakes: 'closed',
  knowledge_chunks: 'closed',
  intake_sessions: 'closed',
  embed_tokens: 'closed',
  media: 'closed',
  workflow_versions: 'closed',
  ticket_events: 'closed',
  agent_sessions: 'closed',
  session_spans: 'closed',
  usage_entries: 'closed',
  usage_cursors: 'closed',
  chat_threads: 'closed',
  chat_messages: 'closed',
  'payload-kv': 'closed',
  'payload-locked-documents': 'closed',
  'payload-jobs': 'closed',
  'payload-preferences': { read: 'own preferences (Payload built-in, keyed to the user)', create: 'own preferences', update: 'own preferences', delete: 'own preferences' },
  'payload-migrations': 'closed',
}

const session = vi.hoisted(() => ({ cookie: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true } as const
let payload: Payload
let testDb: TestDb
let po: Record<string, any>
let bauherr: Record<string, any>
let productOwnerCookie: string
let bauherrCookie: string
const PASSWORD = 'pw-123456-guard'

const notFound = (e: unknown) => /404|NEXT_NOT_FOUND/.test(String((e as { digest?: string })?.digest ?? e))
const asUser = async (cookie: string) => (await payload.auth({ headers: new Headers({ cookie }) })).user as Record<string, any>

beforeAll(async () => {
  testDb = await createTestDb('po_guard')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: PASSWORD, role: 'admin' }, ...o })
  const [a, b] = await Promise.all(['a', 'b'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))
  const a1 = await payload.create({ collection: 'products', data: { name: 'a1', slug: 'a1', workspace: a.id }, ...o })
  await payload.create({ collection: 'products', data: { name: 'b1', slug: 'b1', workspace: b.id }, ...o })
  const mkBauherr = await payload.create({ collection: 'bauherren', data: { email: 'member@x.io', password: PASSWORD, role: 'bauherr', tenants: [{ tenant: a.id }] }, ...o })
  const mkPo = await payload.create({ collection: 'bauherren', data: { email: 'owner@x.io', password: PASSWORD, role: 'product-owner', assignments: [{ workspace: a.id, scope: 'products', products: [a1.id] }] } as never, ...o })
  bauherrCookie = `bauherr-session=${signSession(mkBauherr.id, 0)}`
  productOwnerCookie = `bauherr-session=${signSession(mkPo.id, 0)}`
  po = await asUser(productOwnerCookie)
  bauherr = await asUser(bauherrCookie)
  session.cookie = productOwnerCookie
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('collections', () => {
  it('the list below decides every collection', () => {
    expect(payload.config.collections.map((c) => c.slug).sort()).toEqual(Object.keys(COLLECTIONS).sort())
  })

  it('a Product owner is refused every operation not listed as open (local API, access control on)', async () => {
    const as: Record<string, unknown> = { user: po, overrideAccess: false }
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
        read: () => payload.find({ collection, ...as } as never),
        create: () => payload.create({ collection, data: {}, ...as } as never),
        update: () => payload.update({ collection, id: 1, data: {}, ...as } as never),
        delete: () => payload.delete({ collection, id: 1, ...as } as never),
      }
      for (const [op, run] of Object.entries(ops)) if (!(op in open)) expect(await refused(run), `${collection}.${op} must be refused for a Product owner`).toBe(true)
    }
  })

  it('Payload REST answers a Product owner 403 on every closed collection', async () => {
    const { GET } = await import('../src/app/(payload)/api/[...slug]/route')
    for (const [collection, rule] of Object.entries(COLLECTIONS)) {
      if (rule !== 'closed' || collection.startsWith('payload-')) continue
      const res = await GET(new Request(`http://t/api/${collection}`, { headers: { cookie: productOwnerCookie } }), { params: Promise.resolve({ slug: [collection] }) })
      expect([401, 403], `GET /api/${collection}`).toContain(res.status)
    }
    const { GET: get2 } = await import('../src/app/(payload)/api/[...slug]/route')
    const own = await get2(new Request('http://t/api/bauherren', { headers: { cookie: productOwnerCookie } }), { params: Promise.resolve({ slug: ['bauherren'] }) })
    expect(((await own.json()) as { docs: { email: string }[] }).docs.map((d) => d.email)).toEqual(['owner@x.io'])
  })

  it('a Product owner reads only their own account and cannot open the admin UI', async () => {
    const { docs } = await payload.find({ collection: 'bauherren', user: po, overrideAccess: false } as never)
    expect(docs.map((d) => d.email)).toEqual(['owner@x.io'])
    const adminAccess = payload.collections.bauherren.config.access.admin as (a: unknown) => boolean
    expect(adminAccess({ req: { user: po } })).toBe(false)
  })

  it('a Product owner can change their password and preferences, nothing else on the account', async () => {
    const own = (data: Record<string, unknown>) => payload.update({ collection: 'bauherren', id: po.id, data, user: po, overrideAccess: false, depth: 0 } as never)
    await expect(own({ uiPrefs: { epic: 3 } })).resolves.toMatchObject({ uiPrefs: { epic: 3 } })
    await expect(own({ password: `${PASSWORD}-new` })).resolves.toBeTruthy()
    const before = await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })
    for (const data of [{ role: 'bauherr' }, { role: 'admin' }, { tenants: [] }, { assignments: [] }, { enableAPIKey: true }, { apiKey: 'x'.repeat(32) }, { githubLogin: 'x' }, { oidcSubject: 'x|y' }, { email: 'other@x.io' }]) {
      // Refused, or the field is dropped by its own access rule: either way nothing changes.
      await own(data).catch(() => undefined)
      const after = await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })
      for (const k of ['role', 'tenants', 'assignments', 'enableAPIKey', 'githubLogin', 'oidcSubject', 'email'] as const) expect(after[k] ?? null, `${JSON.stringify(data)} changed ${k}`).toEqual(before[k] ?? null)
    }
    expect(before).toMatchObject({ role: 'product-owner' })
  })

  it('an Admin cannot give a Product owner an API key either', async () => {
    await expect(payload.update({ collection: 'bauherren', id: po.id, data: { enableAPIKey: true, apiKey: 'k'.repeat(32) }, ...o })).rejects.toThrow()
  })

  it('a Bauherr still reads their own Workspace and nothing of another (control for the harness)', async () => {
    const as: Record<string, unknown> = { user: bauherr, overrideAccess: false }
    expect((await payload.find({ collection: 'products', ...as } as never)).docs.map((p) => p.slug)).toEqual(['a1'])
    expect((await payload.find({ collection: 'workspaces', ...as } as never)).docs.map((w) => w.slug)).toEqual(['a'])
  })
})

const APP = '../src/app/'
/** Globs cannot match the literal `(app)` of the route groups: list everything and filter. */
const only = <T>(all: Record<string, T>, keep: (f: string) => boolean): Record<string, T> => Object.fromEntries(Object.entries(all).filter(([f]) => keep(f)))
const pageModules = only(import.meta.glob('../src/app/**/page.tsx'), (f) => f.includes('/(app)/')) as Record<string, () => Promise<{ default: (p: unknown) => Promise<unknown> }>>
const routeModules = only(import.meta.glob('../src/app/**/route.ts'), (f) => !f.includes('/(payload)/')) as Record<string, () => Promise<Record<string, unknown>>>
const appModules = only(import.meta.glob('../src/app/**/*.{ts,tsx}'), (f) => f.includes('/(app)/')) as Record<string, () => Promise<Record<string, unknown>>>
const appSources = only(import.meta.glob('../src/app/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }), (f) => f.includes('/(app)/')) as Record<string, string>

describe('pages', () => {
  const pages = Object.keys(pageModules).map((f) => ({ file: f, route: f.slice((APP + '(app)/').length).replace(/\/?page\.tsx$/, '').replace(/^\(shell\)\/?/, '') }))

  it('the list below decides every page', () => {
    expect(pages.length).toBeGreaterThan(30)
    for (const p of Object.keys(OPEN_PAGES)) expect(pages.map((x) => x.route), `OPEN_PAGES names a page that does not exist: ${p}`).toContain(p)
  })

  it('every page not listed answers a Product owner with a 404 when rendered', async () => {
    session.cookie = productOwnerCookie
    const params = Promise.resolve({ id: '1', number: '1', name: 'x' })
    for (const { file, route } of pages.filter((p) => !(p.route in OPEN_PAGES))) {
      let outcome = 'rendered'
      try {
        await (await pageModules[file]!()).default({ params, searchParams: Promise.resolve({}) })
      } catch (e) {
        outcome = notFound(e) ? '404' : `threw ${String(e)}`
      }
      expect(outcome, `page /${route}`).toBe('404')
    }
  })

  it('the same render as a Bauherr is not a 404 (control for the harness)', async () => {
    session.cookie = bauherrCookie
    const page = await pageModules['../src/app/(app)/(shell)/inbox/page.tsx']!()
    await expect(page.default({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
    session.cookie = productOwnerCookie
  })
})

describe('server actions', () => {
  const files = Object.keys(appModules).filter((f) => /^\s*'use server'/.test(appSources[f] ?? '')).sort()

  it('every action not listed is refused with a 404 for a Product owner', async () => {
    session.cookie = productOwnerCookie
    expect(files.length).toBeGreaterThanOrEqual(6)
    let checked = 0
    for (const f of files) {
      const rel = f.slice((APP + '(app)/').length)
      for (const [name, fn] of Object.entries(await appModules[f]!())) {
        if (typeof fn !== 'function' || `${rel}#${name}` in OPEN_ACTIONS) continue
        let outcome = 'ran'
        try {
          const r = (await (fn as (...a: unknown[]) => Promise<unknown>)(new FormData(), new FormData())) as { error?: string } | undefined
          outcome = r && typeof r === 'object' && 'error' in r ? `returned error ${r.error}` : 'ran'
        } catch (e) {
          outcome = notFound(e) ? '404' : `threw ${String(e)}`
        }
        expect(outcome, `${rel}#${name}`).toBe('404')
        checked++
      }
    }
    expect(checked).toBeGreaterThan(40)
  })

  it('OPEN_ACTIONS names real exports', async () => {
    for (const key of Object.keys(OPEN_ACTIONS)) {
      const [file, name] = key.split('#')
      expect(typeof (await appModules[`${APP}(app)/${file}`]!())[name!]).toBe('function')
    }
  })
})

describe('routes', () => {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  const routes = Object.keys(routeModules).map((f) => ({ file: f, route: f.slice(APP.length).replace(/\/route\.ts$/, '').replace(/\((?:app|shell)\)\/?/g, '') }))

  it('every route handler not listed refuses a Product owner with 401, 403 or 404', async () => {
    const seen: string[] = []
    for (const { file, route } of routes) {
      const mod = await routeModules[file]!()
      const url = `http://t/${route.replace(/\[[^\]]+\]/g, '1')}`
      for (const method of METHODS.filter((m) => typeof mod[m] === 'function')) {
        const key = `${route} ${method}`
        seen.push(key)
        if (key in OPEN_ROUTES) continue
        const read = method === 'GET' || method === 'HEAD'
        const init: RequestInit = { method, headers: { cookie: productOwnerCookie, ...(read ? {} : { 'content-type': 'application/json' }) }, ...(read ? {} : { body: '{}' }) }
        const res = (await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(url, init), { params: Promise.resolve({ id: '1', slug: 'a', sig: 'x', path: [] }) })) as Response
        // A CORS preflight (OPTIONS, 204) carries no data and no session.
        expect(method === 'OPTIONS' ? [204] : [401, 403, 404], key).toContain(res.status)
      }
    }
    for (const key of Object.keys(OPEN_ROUTES)) expect(seen, `OPEN_ROUTES names a route that does not exist: ${key}`).toContain(key)
    expect(seen.length).toBeGreaterThan(20)
  })

  it('/mcp refuses a Product owner behind an agent key too', async () => {
    const { mintAgentKey } = await import('../src/lib/api-key')
    const key = await mintAgentKey(payload, po as never, 'guard')
    const { POST } = await import('../src/app/mcp/route')
    const res = await POST(new Request('http://t/mcp', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }))
    expect(res.status).toBe(403)
  })
})

describe('MCP tools', () => {
  it('every tool not listed is refused for a Product owner', async () => {
    const { callTool, tools } = await import('../src/lib/mcp-tools')
    expect(tools.length).toBeGreaterThan(20)
    for (const tool of tools) {
      if (tool.name in OPEN_TOOLS) continue
      await expect(callTool({ payload, user: po, actor: { kind: 'human' } }, tool.name, {}), tool.name).rejects.toThrow(/forbidden/)
    }
  })
})
