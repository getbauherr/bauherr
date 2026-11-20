import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const PO_PAGES: Record<string, string> = {
  login: 'public sign-in; a signed-in account is sent to its home',
  '': 'the Factory view for a Bauherr; a Product owner gets a static empty state that reads no data',
  settings: 'redirects to the profile',
  'settings/profile': 'the profile',
}
const BAUHERR_PAGES = ['settings/api-key', 'settings/audit', 'settings/bauherren', 'settings/connections', 'settings/health', 'settings/models', 'settings/products', 'settings/products/[id]', 'settings/products/new', 'settings/workspace']
const PO_ROUTES: Record<string, string> = {
  'api/health GET': 'unauthenticated health probe',
  'auth/oidc/login GET': 'sign-in flow',
  'auth/oidc/callback GET': 'sign-in flow',
}
const BAUHERR_ROUTES: string[] = ['mcp GET', 'mcp POST', 'mcp DELETE']
const PO_ACTIONS: Record<string, string> = {
  'lib/actions.ts#login': 'sign-in',
  'lib/actions.ts#logout': 'sign-out',
  '(shell)/settings/profile/actions.ts#saveOwnLogin': 'the profile: links or removes their own forge login; Payload refuses a login another account holds',
}
const BAUHERR_ACTIONS = [
  'lib/actions.ts#selectWorkspace',
  '(shell)/actions.ts#moveCard',
  '(shell)/settings/state-action.ts#setProductState',
].concat(
  ['saveGeneral', 'saveModels', 'savePathSets', 'rotateWorkspaceKey', 'updatePricesNow', 'saveDeploy', 'addRepository', 'repositoriesOf', 'createProductWithRepo', 'removeDoc', 'saveConnection', 'verifyConnection', 'createBauherr', 'createProductOwner', 'saveAssignment', 'changeRole', 'saveBauherr', 'unlockBauherr', 'createWorkspace', 'deleteWorkspace', 'restoreWorkspaceAction', 'mintOwnAgentKey', 'revokeOwnAgentKey', 'rotateOwnKey', 'revokeOwnKey'].map((n) => `(shell)/settings/actions.ts#${n}`),
)
const PO_COLLECTIONS: Record<string, Record<string, string>> = {
  bauherren: { read: 'own account only', update: 'own account: uiPrefs, password and the linked forge login (one account per login) only' },
  'payload-preferences': { read: 'own preferences (Payload built-in, keyed to the user)', create: 'own preferences', update: 'own preferences', delete: 'own preferences' },
}
const BAUHERR_COLLECTIONS = ['agent_keys', 'agent_sessions', 'connections', 'events', 'human_touches', 'instance_state', 'knowledge_chunks', 'mirror_checks', 'mirror_comments', 'mirror_items', 'products', 'proofs', 'records', 'repositories', 'stage_runs', 'ticket_sources', 'workspaces', 'payload-kv', 'payload-locked-documents', 'payload-jobs', 'payload-migrations']
const COLLECTIONS: Record<string, 'closed' | Record<string, string>> = { ...Object.fromEntries(BAUHERR_COLLECTIONS.map((c) => [c, 'closed' as const])), ...PO_COLLECTIONS }
const OPEN_PAGES = PO_PAGES
const OPEN_ROUTES = PO_ROUTES
const OPEN_ACTIONS = PO_ACTIONS

const partition = (what: string, all: string[], po: string[], bauherr: string[]) => {
  expect(new Set([...po, ...bauherr]).size, `${what}: an entry is in both lists or twice`).toBe(po.length + bauherr.length)
  expect([...po, ...bauherr].sort(), `${what}: every one is in exactly one list`).toEqual([...all].sort())
}

const mkBauherrIdRef = { id: 0 }
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
  process.env.MEDIA_DIR = `/tmp/bauherr-po-guard-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: PASSWORD, role: 'admin' }, ...o })
  const [a, b] = await Promise.all(['a', 'b'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))
  const a1 = await payload.create({ collection: 'products', data: { name: 'a1', slug: 'a1', workspace: a.id }, ...o })
  await payload.create({ collection: 'products', data: { name: 'b1', slug: 'b1', workspace: b.id }, ...o })
  await payload.create({ collection: 'products', data: { name: 'a2', slug: 'a2', workspace: a.id }, ...o })
  const mkBauherr = await payload.create({ collection: 'bauherren', data: { email: 'member@x.io', password: PASSWORD, role: 'bauherr', tenants: [{ tenant: a.id }] }, ...o })
  const mkPo = await payload.create({ collection: 'bauherren', data: { email: 'owner@x.io', password: PASSWORD, role: 'product-owner', assignments: [{ workspace: a.id, scope: 'products', products: [a1.id] }] } as never, ...o })
  mkBauherrIdRef.id = mkBauherr.id as number
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
    partition('collections', payload.config.collections.map((c) => c.slug), Object.keys(PO_COLLECTIONS), BAUHERR_COLLECTIONS)
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

  it('a Product owner can change their password, preferences and forge login, nothing else on the account', async () => {
    const own = (data: Record<string, unknown>) => payload.update({ collection: 'bauherren', id: po.id, data, user: po, overrideAccess: false, depth: 0 } as never)
    await expect(own({ uiPrefs: { epic: 3 } })).resolves.toMatchObject({ uiPrefs: { epic: 3 } })
    await expect(own({ password: `${PASSWORD}-new` })).resolves.toBeTruthy()
    const before = await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })
    for (const data of [{ role: 'bauherr' }, { role: 'admin' }, { tenants: [] }, { assignments: [] }, { enableAPIKey: true }, { apiKey: 'x'.repeat(32) }, { oidcSubject: 'x|y' }, { email: 'other@x.io' }]) {
      await own(data).catch(() => undefined)
      const after = await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })
      for (const k of ['role', 'tenants', 'assignments', 'enableAPIKey', 'oidcSubject', 'email'] as const) expect(after[k] ?? null, `${JSON.stringify(data)} changed ${k}`).toEqual(before[k] ?? null)
    }
    expect(before).toMatchObject({ role: 'product-owner' })
  })

  it('a Product owner links their own forge login, and cannot take one another account holds, whatever its case', async () => {
    const own = (data: Record<string, unknown>) => payload.update({ collection: 'bauherren', id: po.id, data, user: po, overrideAccess: false, depth: 0 } as never)
    await payload.update({ collection: 'bauherren', id: mkBauherrIdRef.id, data: { githubLogin: 'Taken-Login' }, ...o })
    await expect(own({ githubLogin: 'taken-login' })).rejects.toThrow()
    await expect(own({ githubLogin: 'po-login' })).resolves.toMatchObject({ githubLogin: 'po-login' })
    await expect(own({ githubLogin: null })).resolves.toMatchObject({ githubLogin: null })
  })

  it('an Admin cannot give a Product owner an API key either', async () => {
    await expect(payload.update({ collection: 'bauherren', id: po.id, data: { enableAPIKey: true, apiKey: 'k'.repeat(32) }, ...o })).rejects.toThrow()
  })

  it('a Bauherr still reads their own Workspace and nothing of another (control for the harness)', async () => {
    const as: Record<string, unknown> = { user: bauherr, overrideAccess: false }
    expect((await payload.find({ collection: 'products', ...as } as never)).docs.map((p) => p.slug).sort()).toEqual(['a1', 'a2'])
    expect((await payload.find({ collection: 'workspaces', ...as } as never)).docs.map((w) => w.slug)).toEqual(['a'])
  })
})

const APP = '../src/app/'
const only = <T>(all: Record<string, T>, keep: (f: string) => boolean): Record<string, T> => Object.fromEntries(Object.entries(all).filter(([f]) => keep(f)))
const pageModules = only(import.meta.glob('../src/app/**/page.tsx'), (f) => f.includes('/(app)/')) as Record<string, () => Promise<{ default: (p: unknown) => Promise<unknown> }>>
const routeModules = only(import.meta.glob('../src/app/**/route.ts'), (f) => !f.includes('/(payload)/')) as Record<string, () => Promise<Record<string, unknown>>>
const appModules = only(import.meta.glob('../src/app/**/*.{ts,tsx}'), (f) => f.includes('/(app)/')) as Record<string, () => Promise<Record<string, unknown>>>
const appSources = only(import.meta.glob('../src/app/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }), (f) => f.includes('/(app)/')) as Record<string, string>

describe('pages', () => {
  const pages = Object.keys(pageModules).map((f) => ({ file: f, route: f.slice((APP + '(app)/').length).replace(/\/?page\.tsx$/, '').replace(/^\(shell\)\/?/, '') }))

  it('the list below decides every page', () => {
    expect(pages.length).toBeGreaterThanOrEqual(14)
    partition('pages', pages.map((p) => p.route), Object.keys(PO_PAGES), BAUHERR_PAGES)
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
    const page = await pageModules['../src/app/(app)/(shell)/settings/products/page.tsx']!()
    await expect(page.default({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
    session.cookie = productOwnerCookie
  })
})

describe('server actions', () => {
  const files = Object.keys(appModules).filter((f) => /^\s*'use server'/.test(appSources[f] ?? '')).sort()

  it('every action not listed is refused with a 404 for a Product owner', async () => {
    session.cookie = productOwnerCookie
    expect(files.length).toBe(5)
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
    expect(checked).toBe(BAUHERR_ACTIONS.length)
  })

  it('the lists decide every action', async () => {
    const all: string[] = []
    for (const f of files) for (const [name, fn] of Object.entries(await appModules[f]!())) if (typeof fn === 'function') all.push(`${f.slice((APP + '(app)/').length)}#${name}`)
    partition('actions', all, Object.keys(PO_ACTIONS), BAUHERR_ACTIONS)
  })

  it('the profile action links the Product owner\'s own login and says why when another account holds it', async () => {
    session.cookie = productOwnerCookie
    const { saveOwnLogin } = (await appModules[`${APP}(app)/(shell)/settings/profile/actions.ts`]!()) as { saveOwnLogin: (p: unknown, fd: FormData) => Promise<{ saved?: boolean; fields?: Record<string, string> }> }
    const form = (login: string) => {
      const fd = new FormData()
      fd.set('githubLogin', login)
      return fd
    }
    expect(await saveOwnLogin({}, form('@po-via-profile'))).toMatchObject({ saved: true })
    expect(await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })).toMatchObject({ githubLogin: 'po-via-profile' })
    await payload.update({ collection: 'bauherren', id: mkBauherrIdRef.id, data: { githubLogin: 'Held-By-Bauherr' }, ...o })
    expect(await saveOwnLogin({}, form('held-by-bauherr'))).toMatchObject({ fields: { githubLogin: 'This forge login is already linked to another account' } })
    expect(await saveOwnLogin({}, form(''))).toMatchObject({ saved: true })
    expect(await payload.findByID({ collection: 'bauherren', id: po.id, depth: 0, ...o })).toMatchObject({ githubLogin: null })
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
        expect(method === 'OPTIONS' ? [204] : [401, 403, 404], key).toContain(res.status)
      }
    }
    for (const key of Object.keys(OPEN_ROUTES)) expect(seen, `OPEN_ROUTES names a route that does not exist: ${key}`).toContain(key)
    expect(seen.length).toBe(6)
    partition('routes', seen, Object.keys(PO_ROUTES), BAUHERR_ROUTES)
  })
})
