import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/**
 * Closed by default: everything a Product owner could reach is enumerated and refused unless it is listed here, with the reason.
 * Adding a page, route, server action, MCP tool or collection fails this file until it is decided: to open something to a Product owner
 * add it to the matching allow-list below (and to docs/spec/people.md), never loosen an existing rule to make this pass.
 */

/**
 * Every page, route handler, server action, chat tool and collection is in exactly one of two lists: `BAUHERR_*` (a Product owner is refused) or `PO_*` (open to a Product owner, with the reason).
 * A page, route, action or collection not in either fails the partition tests below; a `PO_*` entry that shows data must also pass the assignment checks at the end of this file (Product B answers 404).
 */

/** Page routes (relative to src/app/(app), without `/page.tsx`) a Product owner may open. */
const PO_PAGES: Record<string, string> = {
  login: 'public sign-in; a signed-in account is sent to its home',
  settings: 'redirects to the profile',
  'settings/profile': 'the profile',
  requests: 'the four sections, limited to requests of assigned Products and their own drafts',
  'requests/new': 'opens the conversation on their own empty draft for an assigned Product',
  'requests/[id]': 'one request: the card, timeline, "waits for", comments, and the conversation of their own draft or filed request; 404 outside the assignment',
  'tickets/[id]': 'the reduced Ticket page and, where a checkpoint asks them, its decision card and the refinement conversation; 404 outside the assignment',
  inbox: 'only the cards that ask a Product owner (`tickets.needsBy`) on assigned Products',
}
const BAUHERR_PAGES = ['', 'insights', 'knowledge', 'knowledge/edit', 'release-notes', 'releases', 'runs', 'runs/[id]', 'settings/api-key', 'settings/audit', 'settings/bauherren', 'settings/chat-feedback', 'settings/connections', 'settings/health', 'settings/knowledge', 'settings/models', 'settings/products', 'settings/products/[id]', 'settings/products/new', 'settings/templates', 'settings/templates/[name]', 'settings/usage', 'settings/workflow', 'settings/workspace', 'setup', 'team', 'tickets/n/[number]', 'workflow/edit']
/** Route handlers (relative to src/app, `<path> <METHOD>`) that answer a Product owner's session. */
const PO_ROUTES: Record<string, string> = {
  'api/health GET': 'unauthenticated health probe',
  'auth/oidc/login GET': 'sign-in flow',
  'auth/oidc/callback GET': 'sign-in flow',
  'm/[id]/[sig] GET': 'public, signed image link for forge issues; the session is not read',
  'api/tickets/[id]/artifacts/[artifactId] GET': 'review artifacts of assigned Products; 404 elsewhere',
  'intake/api/media/[id] GET': 'files of assigned Products through the signed-in route; 404 elsewhere',
  'api/refine/[ticket]/turn POST': 'a typed answer of the refinement conversation: only rows addressed to the Product owner, on assigned Products (`loadGate`); 404 elsewhere',
  'api/requests/[id]/turn POST': 'one turn of the interview of their own request; 404 for any other',
  'api/requests/media POST': 'a screenshot for their own request conversation, stored in their Workspace',
}
const BAUHERR_ROUTES = ['api/chat/context GET', 'api/chat/media POST', 'api/chat/threads GET', 'api/chat/threads POST', 'api/chat/threads/[id] DELETE', 'api/chat/threads/[id] GET', 'api/chat/threads/[id] PATCH', 'api/chat/threads/[id]/confirm POST', 'api/chat/threads/[id]/feedback POST', 'api/chat/threads/[id]/messages GET', 'api/chat/threads/[id]/messages PUT', 'api/chat/threads/[id]/run POST', 'api/chat/fake-gate POST', 'api/chat/fake-requests GET', ...['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].map((m) => `-/gateway/[[...path]] ${m}`), ...['DELETE', 'GET', 'POST'].map((m) => `mcp ${m}`), 'api/changes GET', 'api/presence GET', 'api/usage POST', 'api/workspaces/[slug]/factory GET', 'api/workspaces/[slug]/factory PUT', 'intake/api/media-limits OPTIONS', 'intake/api/media-limits POST', 'intake/api/sessions OPTIONS', 'intake/api/sessions POST', 'intake/api/sessions/[id] GET', 'intake/api/sessions/[id] OPTIONS', 'intake/api/sessions/[id] POST', 'intake/api/sessions/[id]/messages OPTIONS', 'intake/api/sessions/[id]/messages POST', 'intake/api/sessions/[id]/screenshots OPTIONS', 'intake/api/sessions/[id]/screenshots POST', 'intake/api/sessions/[id]/submit OPTIONS', 'intake/api/sessions/[id]/submit POST']
/** Exported server actions (`<file>#<name>`, file relative to src/app/(app)) a Product owner may call. */
const PO_ACTIONS: Record<string, string> = {
  'lib/actions.ts#login': 'sign-in',
  'lib/actions.ts#logout': 'sign-out',
  'lib/actions.ts#decideAction': 'a card of the Inbox: only decisions addressed to the Product owner on assigned Products (`mayDecide` in every gate function); every other action of a card is refused',
  '(shell)/settings/profile/actions.ts#saveOwnLogin': 'the profile: links or removes their own forge login; Payload refuses a login another account holds',
  ...Object.fromEntries(['refineState', 'refineSay', 'refinePick', 'refineExplain', 'refineRest', 'refineChange', 'refineFinish'].map((n) => [`lib/actions.ts#${n}`, 'the refinement conversation: only rows addressed to the Product owner (`loadGate`, `postDecisions`); no model choice, no cost'])),
  'lib/actions.ts#discardIntake': 'discards their own open draft; 404 for any other',
  'lib/actions.ts#requestState': 'the conversation of their own request; null for any other',
  'lib/actions.ts#requestChange': 'edits their own open draft (card fields, screenshots); refused for any other',
  'lib/actions.ts#requestSubmit': 'files their own draft; refused for any other',
}
const BAUHERR_ACTIONS = [
  'approvePlanAction', 'expediteAction', 'decideOutcomeAction', 'acceptStagingAction', 'approveProductionAction', 'approveSkillProposalAction', 'rejectSkillProposalAction', 'grantReviewRoundAction', 'stopReviewAction', 'backToBuildAction', 'backToBacklogAction', 'requestChangesAction',
  'selectWorkspace', 'reportProblem', 'postDockComment', 'orderRequests', 'refineTier', 'rerunStage', 'releaseRunLock', 'rankTicketAction', 'rankFirstAction', 'saveKnowledgeDocument', 'repairTicketAction', 'relinkRunAction',
].map((n) => `lib/actions.ts#${n}`).concat([
  'lib/search.ts#searchTickets', '(shell)/team/actions.ts#saveRole',
  ...['saveGeneral', 'saveModels', 'saveKnowledge', 'saveOverlapIgnore', 'savePathSets', 'suggestOverlapPaths', 'rotateWorkspaceKey', 'createSessionKey', 'updatePricesNow', 'saveDeploy', 'saveMergeMode', 'saveSecurityScan', 'startScan', 'redetectMerge', 'addRepository', 'repositoriesOf', 'createProductWithRepo', 'mintEmbedToken', 'revokeEmbedToken', 'removeDoc', 'saveConnection', 'verifyConnection', 'saveMonitoring', 'removeMonitoring', 'testMonitoringAction', 'createBauherr', 'createProductOwner', 'saveAssignment', 'changeRole', 'saveBauherr', 'unlockBauherr', 'createWorkspace', 'mintOwnAgentKey', 'revokeOwnAgentKey', 'rotateOwnKey', 'revokeOwnKey', 'saveTemplate', 'resetTemplate'].map((n) => `(shell)/settings/actions.ts#${n}`),
  ...['reviewDraft', 'applyDraft', 'setExpediteLane'].map((n) => `(shell)/workflow/edit/actions.ts#${n}`),
  ...['applyPreset', 'skipSession', 'importIssue'].map((n) => `(shell)/setup/actions.ts#${n}`),
  ...['previewRelease', 'summariseRelease', 'shipReleaseAction'].map((n) => `(shell)/releases/actions.ts#${n}`),
])
/** MCP tools a Product owner may call (none: `/mcp` refuses them behind any key). */
const OPEN_TOOLS: Record<string, string> = {}
/** Chat tools: none is open to a Product owner (the dock is closed to them: `chatWho` refuses every chat route). */
const PO_CHAT_TOOLS: string[] = []
const BAUHERR_CHAT_TOOLS = ['factory_status', 'list_tickets', 'team_status', 'cost_summary', 'get_run', 'list_frontier', 'get_ticket', 'read_worklog', 'read_knowledge', 'search_knowledge', 'approve', 'accept_staging', 'approve_production', 'decide', 'grant_review_round', 'stop_review', 'request_changes', 'post_comment', 'approve_skill_proposal', 'reject_skill_proposal']
/** Collections a Product owner may touch, and how. Every other collection is `BAUHERR_COLLECTIONS`: no operation at all, also over Payload REST. `artifacts` stay closed: proof reaches a Product owner through the Ticket page and its artifact route, never over REST. */
const PO_COLLECTIONS: Record<string, Record<string, string>> = {
  bauherren: { read: 'own account only', update: 'own account: uiPrefs, password and the linked forge login (one account per login) only' },
  'payload-preferences': { read: 'own preferences (Payload built-in, keyed to the user)', create: 'own preferences', update: 'own preferences', delete: 'own preferences' },
}
const BAUHERR_COLLECTIONS = ['agent_keys', 'artifacts', 'workspaces', 'products', 'connections', 'repositories', 'ticket_sources', 'tickets', 'runs', 'steps', 'tool_calls', 'human_touches', 'skill_proposals', 'templates', 'check_flakes', 'knowledge_chunks', 'intake_sessions', 'embed_tokens', 'media', 'workflow_versions', 'ticket_events', 'agent_sessions', 'session_spans', 'usage_entries', 'usage_cursors', 'instance_state', 'chat_threads', 'chat_messages', 'payload-kv', 'payload-locked-documents', 'payload-jobs', 'payload-migrations']
const COLLECTIONS: Record<string, 'closed' | Record<string, string>> = { ...Object.fromEntries(BAUHERR_COLLECTIONS.map((c) => [c, 'closed' as const])), ...PO_COLLECTIONS }
const OPEN_PAGES = PO_PAGES
const OPEN_ROUTES = PO_ROUTES
const OPEN_ACTIONS = PO_ACTIONS

/** Both lists together are the whole set, and nothing is in both. */
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
let mine: { workspace: number; ticket: number; request: number }
let foreign: { otherProduct: { ticket: number; request: number; draft: number }; otherWorkspace: { workspace: number; ticket: number; request: number }; media: number; artifact: number; thread: number }
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
  const b1 = await payload.create({ collection: 'products', data: { name: 'b1', slug: 'b1', workspace: b.id }, ...o })
  const a2 = await payload.create({ collection: 'products', data: { name: 'a2', slug: 'a2', workspace: a.id }, ...o })
  const mkBauherr = await payload.create({ collection: 'bauherren', data: { email: 'member@x.io', password: PASSWORD, role: 'bauherr', tenants: [{ tenant: a.id }] }, ...o })
  const mkPo = await payload.create({ collection: 'bauherren', data: { email: 'owner@x.io', password: PASSWORD, role: 'product-owner', assignments: [{ workspace: a.id, scope: 'products', products: [a1.id] }] } as never, ...o })
  mkBauherrIdRef.id = mkBauherr.id as number
  bauherrCookie = `bauherr-session=${signSession(mkBauherr.id, 0)}`
  productOwnerCookie = `bauherr-session=${signSession(mkPo.id, 0)}`
  po = await asUser(productOwnerCookie)
  bauherr = await asUser(bauherrCookie)
  session.cookie = productOwnerCookie
  const ticket = async (number: number, product: number, workspace: number) => (await payload.create({ collection: 'tickets', data: { title: `Ticket ${number}`, externalId: `g${number}`, number, url: `https://x/${number}`, state: 'open', labels: [], stage: 'plan', product, workspace }, ...o })).id as number
  const request = async (product: number, workspace: number, user: number, status = 'submitted') => (await payload.create({ collection: 'intake_sessions', data: { product, workspace, user, status, persona: 'product-user', messages: [], draft: { problem: 'p', context: '', acceptance_criteria: [], type: 'bug', links: [] } } as never, ...o })).id as number
  mine = { workspace: a.id as number, ticket: await ticket(1, a1.id as number, a.id as number), request: await request(a1.id as number, a.id as number, mkBauherr.id as number) }
  foreign = {
    media: 0,
    artifact: 0,
    thread: 0,
    otherProduct: { ticket: await ticket(2, a2.id as number, a.id as number), request: await request(a2.id as number, a.id as number, mkBauherr.id as number), draft: await request(a2.id as number, a.id as number, mkPo.id as number, 'open') },
    otherWorkspace: { workspace: b.id as number, ticket: await ticket(3, b1.id as number, b.id as number), request: await request(b1.id as number, b.id as number, mkBauherr.id as number) },
  }
  const { saveMedia } = await import('../src/lib/intake/media')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  foreign.media = (await saveMedia(payload, { bytes: png, name: 'x.png', workspace: a.id as number, product: a2.id as number, ticketNumber: 2 })).id as number
  foreign.artifact = (await payload.create({ collection: 'artifacts', data: { ticket: foreign.otherProduct.ticket, workspace: a.id, kind: 'report', title: 'R', text: 'x', sha: 'abc' }, ...o })).id as number
  foreign.thread = (await payload.create({ collection: 'chat_threads', data: { owner: mkBauherr.id, workspace: a.id, title: 'theirs', lastMessageAt: new Date().toISOString() }, ...o })).id as number
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
      // Refused, or the field is dropped by its own access rule: either way nothing changes.
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
        // A CORS preflight (OPTIONS, 204) carries no data and no session.
        expect(method === 'OPTIONS' ? [204] : [401, 403, 404], key).toContain(res.status)
      }
    }
    for (const key of Object.keys(OPEN_ROUTES)) expect(seen, `OPEN_ROUTES names a route that does not exist: ${key}`).toContain(key)
    expect(seen.length).toBeGreaterThan(20)
    partition('routes', seen, Object.keys(PO_ROUTES), BAUHERR_ROUTES)
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

describe('what is open to a Product owner answers 404 outside the assignment', () => {
  const asPo = () => (session.cookie = productOwnerCookie)
  const render = async (file: string, params: Record<string, string>) => {
    try {
      await (await (pageModules[`${APP}(app)/${file}`] as () => Promise<{ default: (p: unknown) => Promise<unknown> }>)()).default({ params: Promise.resolve(params), searchParams: Promise.resolve({}) })
      return 'rendered'
    } catch (e) {
      return notFound(e) ? '404' : `threw ${String(e)}`
    }
  }

  it('the request and Ticket pages: an assigned Product renders, Product B (same Workspace) and another Workspace are 404', async () => {
    asPo()
    const page = (route: string) => `(shell)/${route}/page.tsx`
    expect(await render(page('requests/[id]'), { id: String(mine.request) })).toBe('rendered')
    expect(await render(page('tickets/[id]'), { id: String(mine.ticket) })).toBe('rendered')
    for (const id of [foreign.otherProduct.request, foreign.otherProduct.draft, foreign.otherWorkspace.request, 999_999]) expect(await render(page('requests/[id]'), { id: String(id) }), `request ${id}`).toBe('404')
    for (const id of [foreign.otherProduct.ticket, foreign.otherWorkspace.ticket, 999_999]) expect(await render(page('tickets/[id]'), { id: String(id) }), `ticket ${id}`).toBe('404')
  })

  it('files: media and review artifacts of Product B are 404 for a Product owner', async () => {
    const get = async (route: string, params: Record<string, string>) => ((await routeModules[`${APP}${route}/route.ts`]!()).GET as (r: Request, c: unknown) => Promise<Response>)(new Request('http://t/x', { headers: { cookie: productOwnerCookie } }), { params: Promise.resolve(params) })
    expect((await get('intake/api/media/[id]', { id: String(foreign.media) })).status).toBe(404)
    expect((await get('api/tickets/[id]/artifacts/[artifactId]', { id: String(foreign.otherProduct.ticket), artifactId: String(foreign.artifact) })).status).toBe(404)
  })

  it('the decision and conversation actions and the turn route open to them answer 404 for Product B, and a Bauherr-only option is refused', async () => {
    asPo()
    const actions = await appModules[`${APP}(app)/lib/actions.ts`]!()
    const call = async (name: string, ...args: unknown[]) => {
      try {
        return { returned: await (actions[name] as (...a: unknown[]) => Promise<unknown>)(...args) }
      } catch (e) {
        return { outcome: notFound(e) ? '404' : `threw ${String(e)}` }
      }
    }
    for (const id of [foreign.otherProduct.ticket, foreign.otherWorkspace.ticket, 999_999]) {
      expect(await call('refineState', id), `refineState ${id}`).toEqual({ outcome: '404' })
      expect(await call('refinePick', id, 'D1', 0), `refinePick ${id}`).toEqual({ outcome: '404' })
      expect(await call('refineFinish', id), `refineFinish ${id}`).toEqual({ outcome: '404' })
      expect(await call('decideAction', id, 'Approve plan', 'approvePlan'), `decideAction ${id}`).toEqual({ outcome: '404' })
    }
    // their own Ticket: nothing is addressed to them there, so nothing happens; the options only a Bauherr has are refused up front
    expect(await call('decideAction', mine.ticket, 'Run failed', 'rerun')).toEqual({ returned: { error: 'Only a Bauherr can do this.' } })
    expect(await call('decideAction', mine.ticket, 'Expedite?', 'expedite')).toEqual({ returned: { error: 'Only a Bauherr can do this.' } })
    expect((await call('refineState', mine.ticket)).outcome).toBeUndefined() // reached: the harness has no forge, so it answers an error text, not a 404
    expect(await call('refineTier', mine.ticket, 'strong')).toEqual({ outcome: '404' })
    const { POST } = (await routeModules[`${APP}api/refine/[ticket]/turn/route.ts`]!()) as { POST: (r: Request, c: unknown) => Promise<Response> }
    for (const id of [foreign.otherProduct.ticket, foreign.otherWorkspace.ticket, 999_999]) {
      const res = await POST(new Request('http://t/x', { method: 'POST', headers: { cookie: productOwnerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) }), { params: Promise.resolve({ ticket: String(id) }) })
      expect(res.status, `turn ${id}`).toBe(404)
    }
  })

  it('every chat tool is closed to a Product owner, and every chat route refuses them', async () => {
    const { chatTools } = await import('../src/lib/chat/tools')
    partition('chat tools', chatTools({ role: 'admin' }).map((t) => t.name), PO_CHAT_TOOLS, BAUHERR_CHAT_TOOLS)
    const { GET } = await import('../src/app/api/chat/threads/route')
    expect((await GET(new Request('http://t/x', { headers: { cookie: productOwnerCookie } }))).status).toBe(403)
  })

  it('the request conversation: their own draft opens, Product B and a draft of someone else are refused on every door', async () => {
    asPo()
    const actions = await import('../src/app/(app)/lib/actions')
    const a1 = ((await payload.findByID({ collection: 'intake_sessions', id: mine.request, depth: 0, ...o })) as Record<string, any>).product as number
    const draft = await payload.create({ collection: 'intake_sessions', data: { product: a1, workspace: mine.workspace, user: po.id, persona: 'product-user', status: 'open', messages: [] } as never, ...o })
    expect(await actions.requestState(draft.id as number)).toMatchObject({ view: { session: draft.id, card: { editable: true } } })
    expect(await actions.requestState(foreign.otherProduct.draft)).toEqual({ view: null }) // their own draft, but of a Product they are not assigned to
    expect(await actions.requestState(mine.request)).toEqual({ view: null }) // a request of someone else
    expect(await actions.requestChange(foreign.otherProduct.draft, { patch: { title: 'x' } })).toMatchObject({ error: expect.stringContaining('not found') })
    expect(await actions.requestSubmit(mine.request)).toMatchObject({ error: expect.stringContaining('not found') })
    const turn = (id: number) => (routeModules[`${APP}api/requests/[id]/turn/route.ts`]!() as Promise<{ POST: (r: Request, c: unknown) => Promise<Response> }>).then((m) => m.POST(new Request('http://t/x', { method: 'POST', headers: { cookie: productOwnerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello' }) }), { params: Promise.resolve({ id: String(id) }) }))
    expect((await turn(foreign.otherProduct.draft)).status).toBe(404)
    expect((await turn(mine.request)).status).toBe(404)
    expect((await turn(draft.id as number)).status).toBe(200)
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'x.png')
    const wire = new Request('http://t/x', { method: 'POST', body: form })
    const body = new Uint8Array(await wire.arrayBuffer())
    const upload = await (await routeModules[`${APP}api/requests/media/route.ts`]!() as { POST: (r: Request) => Promise<Response> }).POST(new Request('http://t/x', { method: 'POST', headers: { cookie: productOwnerCookie, 'content-type': wire.headers.get('content-type')!, 'content-length': String(body.byteLength) }, body }))
    expect(upload.status).toBe(201)
    expect(await render('(shell)/requests/new/page.tsx', {})).toMatch(/threw .*NEXT_REDIRECT/)
  })
})
