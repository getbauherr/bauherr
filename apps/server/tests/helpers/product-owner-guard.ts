import type { Payload, User } from 'payload'
import { expect } from 'vitest'
import { z } from 'zod'
import { createTestDb, type TestDb } from './test-db'

export const PO_PAGES: Record<string, string> = {
  login: 'public sign-in; a signed-in account is sent to its home',
  '': 'the Factory view for a Bauherr; a Product owner gets a static empty state that reads no data',
  requests: 'the Requests of the Products assigned to them, nothing else',
  'requests/new': 'the new request screen; only the Products assigned to them are offered (request-new-guard.test.ts)',
  'requests/[id]': 'one request of an assigned Product; any other answers 404 (request-page-guard.test.ts)',
}
export const BAUHERR_PAGES = [
  'settings',
  'conversations',
  'conversations/[id]',
  'inbox',
  'insights',
  'memory',
  'memory/retro',
  'memory/retro/[id]',
  'memory/retro/[id]/outcome',
  'releases',
  'runs/[id]',
  'tickets/[id]',
  'settings/api-key',
  'settings/profile',
  'settings/audit',
  'settings/bauherren',
  'settings/connections',
  'settings/health',
  'settings/models',
  'settings/products',
  'settings/products/[id]',
  'settings/products/new',
  'settings/workspace',
]
export const PO_ROUTES: Record<string, string> = {
  'api/hooks/[connection] POST': 'forge webhook: no session, signature-verified',
  'api/health GET': 'unauthenticated health probe',
  'api/attachments/upload/[token] PUT': 'run image upload: no session, a one-time token',
  'api/request-files/[id]/[fileId]/[token] GET': 'sent request file for forge readers: no session, an HMAC token',
  'api/request-pictures/[id]/[attachment]/[token] GET':
    'request picture for forge readers: no session, an HMAC token bound to the request',
  'api/requests POST': 'starts a request draft; only for an assigned Product (request-new-guard.test.ts)',
  'api/requests/[id] GET': 'reads a request draft of an assigned Product (request-new-guard.test.ts)',
  'api/requests/[id] POST': 'acts on a request draft of an assigned Product (request-new-guard.test.ts)',
  'auth/oidc/login GET': 'sign-in flow',
  'auth/oidc/callback GET': 'sign-in flow',
}
export const BAUHERR_ROUTES: string[] = [
  'api/attachments/[id] GET',
  'api/conversations POST',
  'api/conversations/[id] GET',
  'api/conversations/[id] POST',
  'api/conversations/[id]/files POST',
  'api/conversations/[id]/files/[fileId] GET',
  'api/changes GET',
  'api/fake-forge GET',
  'mcp GET',
  'mcp POST',
  'mcp DELETE',
]
export const PO_ACTIONS: Record<string, string> = {
  'lib/actions.ts#login': 'sign-in',
  'lib/actions.ts#logout': 'sign-out',
  '(shell)/requests/actions.ts#startRequestConversation': 'comment on a request of their own product',
  '(shell)/requests/actions.ts#commentOnRequestAction': 'comment on a request of their own product',
}
export const BAUHERR_ACTIONS = [
  '(shell)/settings/profile/actions.ts#saveOwnLogin',
  'lib/actions.ts#selectWorkspace',
  '(shell)/actions.ts#moveCard',
  '(shell)/tickets/actions.ts#decideTicket',
  '(shell)/tickets/archive-actions.ts#archiveTicket',
  '(shell)/tickets/archive-actions.ts#restoreTicket',
  '(shell)/memory/retro/actions.ts#startRetroAction',
  '(shell)/memory/retro/actions.ts#prepareOpeningAction',
  '(shell)/memory/retro/actions.ts#sendMessageAction',
  '(shell)/memory/retro/actions.ts#acceptProposalAction',
  '(shell)/memory/retro/actions.ts#toOutcomeAction',
  '(shell)/memory/retro/actions.ts#decideChangeAction',
  '(shell)/memory/retro/actions.ts#editChangeAction',
  '(shell)/memory/retro/actions.ts#decideTicketAction',
  '(shell)/memory/retro/actions.ts#applyRetroAction',
  '(shell)/memory/document-actions.ts#saveDocumentAction',
  '(shell)/settings/state-action.ts#setProductState',
  '(shell)/settings/webhook-action.ts#createWebhookSecret',
].concat(
  [
    'saveGeneral',
    'saveModels',
    'savePathSets',
    'rotateWorkspaceKey',
    'updatePricesNow',
    'addRepository',
    'repositoriesOf',
    'createProductWithRepo',
    'removeDoc',
    'saveConnection',
    'verifyConnection',
    'createBauherr',
    'createProductOwner',
    'saveAssignment',
    'changeRole',
    'saveBauherr',
    'unlockBauherr',
    'createWorkspace',
    'deleteWorkspace',
    'restoreWorkspaceAction',
    'mintOwnAgentKey',
    'revokeOwnAgentKey',
    'rotateOwnKey',
    'revokeOwnKey',
  ].map((n) => `(shell)/settings/actions.ts#${n}`),
)
const CONNECT_PAGES = ['settings/products/[id]/connect']
BAUHERR_PAGES.push(...CONNECT_PAGES)
const PRODUCT_SECTION_ACTIONS = [
  'saveExecutor',
  'saveIntake',
  'saveGates',
  'saveProof',
  'saveReleaseMode',
  'copyForgeChecks',
  'saveReadinessFix',
  'checkReadinessNow',
  'makeReadinessTicket',
]
BAUHERR_ACTIONS.push(...PRODUCT_SECTION_ACTIONS.map((n) => `(shell)/settings/products/[id]/actions.ts#${n}`))
export const PO_COLLECTIONS: Record<string, Record<string, string>> = {
  bauherren: {
    read: 'own account only',
    update: 'own account: uiPrefs, password and the linked forge login (one account per login) only',
  },
  'payload-preferences': {
    read: 'own preferences (Payload built-in, keyed to the user)',
    create: 'own preferences',
    update: 'own preferences',
    delete: 'own preferences',
  },
}
export const BAUHERR_COLLECTIONS = [
  'agent_keys',
  'agent_sessions',
  'attachments',
  'connections',
  'conversation_files',
  'conversation_messages',
  'conversations',
  'events',
  'human_touches',
  'instance_state',
  'knowledge_chunks',
  'memory_document_versions',
  'mirror_checks',
  'mirror_comments',
  'mirror_items',
  'products',
  'proofs',
  'retros',
  'retro_messages',
  'records',
  'repo_instruction_files',
  'request_drafts',
  'repositories',
  'stage_runs',
  'statements',
  'ticket_relations',
  'ticket_sources',
  'workspaces',
  'payload-kv',
  'payload-locked-documents',
  'payload-jobs',
  'payload-migrations',
]
export const COLLECTIONS: Record<string, 'closed' | Record<string, string>> = {
  ...Object.fromEntries(BAUHERR_COLLECTIONS.map((c) => [c, 'closed' as const])),
  ...PO_COLLECTIONS,
}
export const OPEN_PAGES = PO_PAGES
export const OPEN_ROUTES = PO_ROUTES
export const OPEN_ACTIONS = PO_ACTIONS

export const partition = (what: string, all: string[], po: string[], bauherr: string[]) => {
  expect(new Set([...po, ...bauherr]).size, `${what}: an entry is in both lists or twice`).toBe(
    po.length + bauherr.length,
  )
  expect([...po, ...bauherr].sort(), `${what}: every one is in exactly one list`).toEqual([...all].sort())
}

export const stringsOf = (docs: unknown, key: string): string[] =>
  z
    .array(z.record(z.string(), z.unknown()))
    .parse(docs)
    .map((d) => z.string().parse(d[key]))

export const session = { cookie: '' }

export const nextHeadersMock = () => ({
  headers: async () => new Headers({ cookie: session.cookie }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
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
