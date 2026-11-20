import { isDeepStrictEqual } from 'node:util'
import {
  type CollectionAfterReadHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeValidateHook,
  type PayloadRequest,
  type TypeWithID,
  ValidationError,
} from 'payload'
import { ACCOUNT_LOCKED, accountLocked, carriesPayloadCredential, lockedRequests } from '../lib/oidc-session'
import { assignmentRows, tenantIds } from '../lib/people'
import { lockAccount } from './locks'

const SELF_FIELDS = ['uiPrefs', 'password', 'githubLogin']

type AccountData = {
  role?: string
  enableAPIKey?: boolean
  apiKey?: string
  githubLogin?: string | null
  assignments?: unknown[]
  tenants?: unknown
}
type AccountDoc = AccountData & { id?: number | string; updatedAt?: string }
type Req = PayloadRequest

const accountError = (path: string, message: string) =>
  new ValidationError({ collection: 'bauherren', errors: [{ path, message }] })

const assertUnchangedSinceRead = async (req: Req, original: AccountDoc & { id: number | string }): Promise<void> => {
  await lockAccount(req, original.id)
  const fresh = (await req.payload.findByID({
    collection: 'bauherren',
    id: original.id,
    depth: 0,
    overrideAccess: true,
    select: { updatedAt: true },
    req,
  })) as { updatedAt?: string }
  if (fresh.updatedAt !== original.updatedAt)
    throw accountError('id', 'This account changed while you were editing it. Reload and try again.')
}

const assertOnlyOwnFields = (data: Record<string, unknown>, original: Record<string, unknown>): void => {
  const other = Object.keys(data).filter(
    (k) =>
      ![...SELF_FIELDS, 'updatedAt', 'createdAt'].includes(k) &&
      !isDeepStrictEqual(data[k] ?? null, original[k] ?? null),
  )
  if (other.length)
    throw accountError(
      other[0] ?? '',
      'A Product owner can change only the password, display preferences and forge login',
    )
}

const loginsOf = (value: unknown): string[] =>
  String(value)
    .split(',')
    .map((l) => l.trim().toLowerCase())

const assertForgeLoginFree = async (req: Req, login: string, originalId: number | string | undefined) => {
  const mine = loginsOf(login).filter(Boolean)
  const others = await req.payload.find({
    collection: 'bauherren',
    where: {
      and: [{ githubLogin: { exists: true } }, ...(originalId != null ? [{ id: { not_equals: originalId } }] : [])],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { githubLogin: true },
    req,
  })
  if (others.docs.some((u) => loginsOf(u.githubLogin).some((l) => mine.includes(l))))
    throw accountError('githubLogin', 'This forge login is already linked to another account')
}

const asksForApiKey = (data: AccountData, original: AccountDoc): boolean =>
  !!(data.enableAPIKey && !original.enableAPIKey) || !!(data.apiKey && data.apiKey !== original.apiKey)

const assertNoApiKeyForProductOwner = (data: AccountData, original: AccountDoc): void => {
  if ((data.role ?? original.role) !== 'product-owner') return
  if (asksForApiKey(data, original)) throw accountError('enableAPIKey', 'A Product owner cannot have an API key')
  if (data.enableAPIKey) data.enableAPIKey = false
}

const validateUpdate = async (req: Req, data: AccountData, original: AccountDoc): Promise<void> => {
  if (original.id != null) await assertUnchangedSinceRead(req, { ...original, id: original.id })
  if (req.user?.role === 'product-owner') assertOnlyOwnFields(data, original)
}

export const validateAccount: CollectionBeforeValidateHook = async ({ data, originalDoc, operation, req }) => {
  if (!data) return data
  const next = data as AccountData
  const original = (originalDoc ?? {}) as AccountDoc
  if (operation === 'update') await validateUpdate(req, next, original)
  if (next.githubLogin && next.githubLogin !== original.githubLogin)
    await assertForgeLoginFree(req, next.githubLogin, original.id)
  assertNoApiKeyForProductOwner(next, original)
  return data
}

export const refuseLockedCredential: CollectionAfterReadHook<TypeWithID> = async ({ doc, req }) => {
  if (!req.user && carriesPayloadCredential(req.headers) && (await accountLocked(req.payload, doc.id))) {
    lockedRequests.add(req.headers)
    throw new Error(ACCOUNT_LOCKED)
  }
  return doc
}

const assignmentsError = (message: string) =>
  new ValidationError({ collection: 'bauherren', errors: [{ path: 'assignments', message }] })

const assertProductsInWorkspaces = async (req: Req, rows: ReturnType<typeof assignmentRows>): Promise<void> => {
  if (new Set(rows.map((r) => r.workspace)).size !== rows.length)
    throw assignmentsError('At most one assignment per Workspace')
  for (const r of rows) {
    if (!r.products.length) continue
    const found = await req.payload.count({
      collection: 'products',
      where: { id: { in: r.products }, workspace: { equals: r.workspace } },
      overrideAccess: true,
      req,
    })
    if (found.totalDocs !== new Set(r.products).size)
      throw assignmentsError('Products must belong to the Workspace of their assignment')
  }
}

const syncProductOwner = async (req: Req, data: AccountData, original: AccountDoc): Promise<void> => {
  const rows = assignmentRows(data.assignments ?? original.assignments)
  if (data.assignments !== undefined) {
    await assertProductsInWorkspaces(req, rows)
    if (!isDeepStrictEqual(rows, assignmentRows(original.assignments))) data.assignments = rows
  }
  const want = rows.map((r) => r.workspace)
  const have = tenantIds({ tenants: data.tenants ?? original.tenants })
  if (want.length !== have.length || want.some((w, i) => w !== have[i]))
    data.tenants = want.map((tenant) => ({ tenant }))
}

const isFirstLocalAccount = async (req: Req, operation: string): Promise<boolean> =>
  operation === 'create' && !req.context.oidc && (await req.payload.count({ collection: 'bauherren' })).totalDocs === 0

const shapeNonProductOwner = (data: AccountData, original: AccountDoc): void => {
  if (data.role && original.role === 'product-owner') data.assignments = []
  else if (data.assignments?.length) throw assignmentsError('Only a Product owner has assignments')
}

export const shapeAccount: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req }) => {
  const next = data as AccountData
  const original = (originalDoc ?? {}) as AccountDoc
  if (await isFirstLocalAccount(req, operation)) next.role = 'admin'
  if ((next.role ?? original.role) !== 'product-owner') {
    shapeNonProductOwner(next, original)
    return data
  }
  await syncProductOwner(req, next, original)
  return data
}
