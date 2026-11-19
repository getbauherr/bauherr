'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createLocalReq } from 'payload'
import { mintAgentKey, revokeAgentKey, revokeApiKey, rotateApiKey } from '../../../../lib/api-key'
import { backendFor, verifyForge } from '../../../../lib/adapters'
import { connectionInput, credentialName, forgeConfig } from '../../../../lib/connection'
import { withLoginLock } from '../../../../lib/login-lock'
import { parsePathSets, type PathSets } from '../../../../lib/path-sets'
import { rotateKey } from '../../../../lib/gateway'
import { refreshPrices } from '../../../../lib/prices'
import { PRESET_FIELDS } from '../../../../lib/providers'
import { deleteProductMirror, deleteSourceMirror } from '../../../../core/mirror/store'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../../../../lib/settings-guards'
import { deployErrors } from '../../lib/product-setup'
import { listRepos, only, presetFor, run, type FormState } from '../../lib/settings'
import { currentWorkspace, payloadClient, workspacesOf } from '../../lib/session'
import { OTHER_REPO, slugOf } from '../../lib/new-product'
import { assignmentRows } from '../../../../lib/people'
import { archiveWorkspace, restoreWorkspace } from '../../../../lib/workspace-delete'

type Form = (prev: FormState, fd: FormData) => Promise<FormState>

async function ctx() {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const w = { user, overrideAccess: false } as const
  return { user, workspace, payload, w }
}
const act = (rename: Record<string, string>, fn: (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => Promise<string | void>): Form =>
  async (_prev, fd) => {
    const c = await ctx()
    const result = await run(() => fn(c, fd), rename)
    if (result.saved) {
      revalidatePath('/settings', 'layout')
    }
    return result
  }
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()
const id = (fd: FormData) => Number(fd.get('id'))
const inWorkspace = (c: { workspace: { id: number } | null }) => {
  if (!c.workspace) throw new Error('No Workspace selected.')
  return c.workspace.id
}

export const saveGeneral = act({}, async ({ user, workspace, payload, w }, fd) => {
  only(user)
  await payload.update({ collection: 'workspaces', id: inWorkspace({ workspace }), data: { name: s(fd, 'name') }, ...w } as never)
})

export const saveModels = act({ budgetUsd30d: 'budgetAmount', budgetTokens30d: 'budgetAmount' }, async ({ user, workspace, payload, w }, fd) => {
  only(user)
  const wsId = inWorkspace({ workspace })
  const unit = s(fd, 'budgetUnit') === 'tokens' ? 'tokens' : 'usd'
  const amount = s(fd, 'budgetAmount')
  const data: Record<string, unknown> = { budgetUnit: unit, [unit === 'usd' ? 'budgetUsd30d' : 'budgetTokens30d']: amount === '' ? null : Number(amount) }
  const { defaultModels: defaults, slugs } = await presetFor(wsId)
  const missing = (['cheap', 'standard', 'strong'] as const).filter((t) => !s(fd, `tier_${t}`) && !defaults)
  if (missing.length) throw Object.assign(new Error('Model tiers missing.'), { data: { errors: missing.map((t) => ({ path: `tier_${t}`, message: 'This provider has no default; set a model id' })) } })
  const qualify = (v: string) => (!slugs.length || slugs.some((c) => v.startsWith(`${c}/`)) ? v : `${slugs[0]}/${v}`)
  const tiers = Object.fromEntries((['cheap', 'standard', 'strong'] as const).map((t) => [t, qualify(s(fd, `tier_${t}`) || defaults![t])]))
  data.modelByTier = tiers
  await payload.update({ collection: 'workspaces', id: wsId, data, ...w } as never)
})

export const savePathSets = act({ sets: 'sets' }, async (c, fd) => {
  only(c.user)
  const product = id(fd)
  await assertInWorkspace(c.payload, 'products', [product], inWorkspace(c))
  let pathSets: PathSets
  try {
    pathSets = parsePathSets(s(fd, 'sets'))
  } catch (e) {
    throw fieldError('sets', (e as Error).message)
  }
  await c.payload.update({ collection: 'products', id: product, data: { pathSets }, ...c.w } as never)
})

export const rotateWorkspaceKey = act({}, async ({ user, workspace, payload }) => {
  only(user)
  await rotateKey(await createLocalReq({ user }, payload), inWorkspace({ workspace }))
})

export const updatePricesNow = act({}, async ({ user, payload }) => {
  only(user)
  const status = await refreshPrices(payload, { force: true })
  if (status?.error) throw new Error(status.error.message)
  if (!status) throw new Error('Price updates are switched off on this instance (BAUHERR_PRICES_REFRESH=0).')
})

const inWs = (c: Awaited<ReturnType<typeof ctx>>, collection: string, ...ids: (number | undefined)[]) => assertInWorkspace(c.payload, collection, ids, inWorkspace(c))

const makeProduct = async (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => {
  const name = s(fd, 'name')
  const slug = s(fd, 'slug') || slugOf(name)
  if (!/^[a-z0-9-]+$/.test(slug)) throw Object.assign(new Error('Short name invalid.'), { data: { errors: [{ path: 'slug', message: 'Use lowercase letters, digits and dashes.' }] } })
  return (await c.payload.create({ collection: 'products', data: { name, slug, workspace: inWorkspace(c) }, ...c.w } as never)).id as number
}

const TEXT_FIELDS = ['stagingUrl', 'deployMode', 'deployWebhookUrl', 'deployChecks', 'productionWebhookUrl', 'productionChecks'] as const

export const saveDeploy = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const data: Record<string, unknown> = Object.fromEntries(TEXT_FIELDS.filter((k) => fd.has(k)).map((k) => [k, s(fd, k)]))
  if (fd.has('productionGateShown')) data.productionGate = fd.get('productionGate') === 'on'
  const before = (await c.payload.findByID({ collection: 'products', id: id(fd), select: { stagingUrl: true, deployMode: true, deployWebhookUrl: true, productionWebhookUrl: true, productionGate: true, productionChecks: true }, depth: 0, overrideAccess: true })) as Record<string, unknown>
  const merged = { stagingUrl: '', deployWebhookUrl: '', productionWebhookUrl: '', productionChecks: '', deployMode: 'observe-ci', productionGate: false, ...before, ...data } as Parameters<typeof deployErrors>[0]
  const errors = Object.entries(deployErrors(merged)).filter(([path]) => path in data).map(([path, message]) => ({ path, message }))
  if (errors.length) throw Object.assign(new Error('Deploy settings invalid.'), { data: { errors } })
  await c.payload.update({ collection: 'products', id: id(fd), data, ...c.w } as never)
})

const makeRepository = async (c: Awaited<ReturnType<typeof ctx>>, product: number, fd: FormData) => {
  const connection = Number(s(fd, 'connection')) || undefined
  const fullName = s(fd, 'fullName')
  await inWs(c, 'connections', connection)
  const repo = await c.payload.create({ collection: 'repositories', data: { fullName, product, workspace: inWorkspace(c) }, ...c.w } as never)
  if (fd.get('readTickets') !== 'on') return
  try {
    await c.payload.create({ collection: 'ticket_sources', data: { repo: fullName, connection, product, workspace: inWorkspace(c) }, ...c.w } as never)
  } catch (e) {
    await c.payload.delete({ collection: 'repositories', id: repo.id, ...c.w } as never)
    throw e
  }
}
export const addRepository = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  await makeRepository(c, id(fd), fd)
})

export async function repositoriesOf(connection: number): Promise<string[] | null> {
  const c = await ctx()
  only(c.user)
  await inWs(c, 'connections', Number(connection))
  return listRepos(Number(connection))
}

const fieldError = (path: string, message: string) => Object.assign(new Error(message), { data: { errors: [{ path, message }] } })

export const createProductWithRepo = act({}, async (c, fd) => {
  only(c.user)
  const slug = s(fd, 'slug') || slugOf(s(fd, 'name'))
  if ((await c.payload.count({ collection: 'products', where: { and: [{ slug: { equals: slug } }, { workspace: { equals: inWorkspace(c) } }] }, overrideAccess: true } as never)).totalDocs) throw fieldError('slug', 'Another Product already uses this short name.')
  if (s(fd, 'fullName') === OTHER_REPO) fd.set('fullName', s(fd, 'repoOther'))
  if (!s(fd, 'fullName')) throw fieldError('fullName', 'Choose a repository.')
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(s(fd, 'fullName'))) throw fieldError('fullName', 'Use owner/name, for example acme/shop.')
  const product = await makeProduct(c, fd)
  fd.set('readTickets', 'on')
  try {
    await makeRepository(c, product, fd)
  } catch (e) {
    await c.payload.delete({ collection: 'products', id: product, ...c.w } as never)
    throw e
  }
  if (fd.get('open') === '1') redirect(`/settings/products/${product}?tab=deploy#staging`)
})

const COLLECTIONS = ['products', 'repositories', 'ticket_sources', 'bauherren']
export const removeDoc = act({}, async (c, fd) => {
  only(c.user)
  const collection = s(fd, 'collection')
  if (!COLLECTIONS.includes(collection)) throw new Error('Unknown collection.')
  if (collection === 'bauherren') {
    if (id(fd) === c.user.id) throw new Error('You cannot remove yourself.')
    await assertAnotherAdmin(c.payload, id(fd))
  } else await inWs(c, collection, id(fd))
  if (collection === 'products') {
    const blocked = await blockedBy(c.payload, 'products', id(fd))
    if (blocked) throw new Error(`Still referenced by ${blocked}.`)
  }
  if (collection === 'ticket_sources') await deleteSourceMirror(c.payload, id(fd))
  if (collection === 'products') await deleteProductMirror(c.payload, id(fd))
  await c.payload.delete({ collection, id: id(fd), ...c.w } as never)
  if (collection === 'products') redirect('/settings/products')
})

export const saveConnection = act({}, async (c, fd) => {
  only(c.user)
  const kind = s(fd, 'kind')
  const data: Record<string, unknown> = { name: s(fd, 'name'), kind }
  if (kind === 'llm-provider') {
    data.provider = s(fd, 'provider')
    for (const k of PRESET_FIELDS) if (fd.has(k)) data[k] = s(fd, k)
  }
  if (kind !== 'llm-provider') data.config = await forgeConfig(c.payload, id(fd), kind, (k) => s(fd, k))
  if (s(fd, 'secret')) data.secret = s(fd, 'secret')
  if (id(fd)) {
    await inWs(c, 'connections', id(fd))
    if (kind !== 'llm-provider' && s(fd, 'secret')) data.capabilities = { ...(await connectionInput(c.payload, id(fd))).capabilities, verifiedAt: undefined, lastError: undefined }
    await c.payload.update({ collection: 'connections', id: id(fd), data, ...c.w } as never)
  } else await c.payload.create({ collection: 'connections', data: { ...data, workspace: inWorkspace(c) }, ...c.w } as never)
})

export const verifyConnection = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'connections', id(fd))
  const conn = await connectionInput(c.payload, id(fd))
  if (conn.kind === 'llm-provider') {
    await c.payload.update({ collection: 'connections', id: id(fd), data: {}, ...c.w } as never)
    return
  }
  let failure: { message: string; refused: boolean } | null = null
  try {
    await verifyForge(conn, { maxRetries: 0, timeoutMs: 10_000 })
  } catch (e) {
    failure = { message: (e as Error).message, refused: [401, 403].includes((e as { status?: number }).status ?? 0) }
  }
  await c.payload.update({ collection: 'connections', id: id(fd), data: { capabilities: { ...conn.capabilities, verifiedAt: failure ? null : new Date().toISOString(), lastError: failure?.message ?? null } }, overrideAccess: true } as never)
  if (failure) throw new Error(`${failure.refused ? 'The forge did not accept' : 'Could not verify'} ${credentialName(conn)}: ${failure.message}`)
})

const tenants = (fd: FormData) => fd.getAll('workspaces').map(Number)
const known = async (c: Awaited<ReturnType<typeof ctx>>, ids: number[]) => {
  const own = (await workspacesOf(c.user)).map((w) => w.id)
  if (ids.some((i) => !own.includes(i))) throw new Error('Not in this Workspace')
}
export const createBauherr = act({}, async (c, fd) => {
  only(c.user)
  if (s(fd, 'role') !== 'admin' && s(fd, 'role') !== 'bauherr') throw new Error('Choose Admin or Bauherr.')
  await known(c, tenants(fd))
  const password = randomBytes(12).toString('base64url')
  await c.payload.create({ collection: 'bauherren', data: { email: s(fd, 'email'), password, role: s(fd, 'role'), tenants: tenants(fd).map((tenant) => ({ tenant })) }, ...c.w } as never)
  return `Temporary password (shown once): ${password}`
})

const githubKnows = async (c: Awaited<ReturnType<typeof ctx>>, login: string): Promise<boolean> => {
  const first = (await c.payload.find({ collection: 'connections', where: { and: [{ workspace: { equals: inWorkspace(c) } }, { kind: { equals: 'github' } }] }, sort: 'id', limit: 1, depth: 0, overrideAccess: true } as never)).docs[0]
  if (!first) return true
  try {
    return await backendFor(await connectionInput(c.payload, first.id as number), { maxRetries: 0, timeoutMs: 10_000 }).tickets('').userExists(login)
  } catch {
    return true
  }
}

const assignmentFrom = async (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => {
  const workspace = Number(s(fd, 'workspace'))
  await known(c, [workspace])
  const scope = s(fd, 'scope') === 'workspace' ? 'workspace' : 'products'
  return { workspace, scope, products: scope === 'products' ? [...new Set(fd.getAll('products').map(Number))] : [] }
}

export const createProductOwner = act({}, async (c, fd) => {
  only(c.user)
  const assignment = await assignmentFrom(c, fd)
  const password = randomBytes(12).toString('base64url')
  await c.payload.create({ collection: 'bauherren', data: { email: s(fd, 'email'), password, role: 'product-owner', assignments: [assignment] }, ...c.w } as never)
  return `Temporary password (shown once): ${password}`
})

export const saveAssignment = act({}, async (c, fd) => {
  only(c.user)
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  if (target.role !== 'product-owner') throw new Error('Not a Product owner.')
  const workspace = Number(s(fd, 'workspace'))
  const rest = assignmentRows(target.assignments).filter((r) => r.workspace !== workspace)
  const assignments = s(fd, 'scope') === 'none' ? rest : [...rest, await assignmentFrom(c, fd)]
  await withLoginLock(target.email, () => c.payload.update({ collection: 'bauherren', id: id(fd), data: { assignments }, ...c.w } as never))
})

export const changeRole = act({}, async (c, fd) => {
  only(c.user)
  const role = s(fd, 'role')
  if (role !== 'bauherr' && role !== 'product-owner') throw new Error('Choose Bauherr or Product owner.')
  if (id(fd) === c.user.id) throw new Error('You cannot change your own role.')
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  if (target.role !== s(fd, 'from')) throw new Error('This account changed meanwhile. Reload the page.')
  if (target.role === 'admin') await assertAnotherAdmin(c.payload, id(fd))
  if (target.role !== role) await withLoginLock(target.email, () => c.payload.update({ collection: 'bauherren', id: id(fd), data: { role }, ...c.w } as never))
})

export const saveBauherr = act({}, async (c, fd) => {
  only(c.user)
  const ids = tenants(fd)
  await known(c, ids)
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  if (target.role === 'product-owner') throw new Error('Use the Product owner form.')
  if (s(fd, 'role') !== 'admin' && s(fd, 'role') !== 'bauherr') throw new Error('Choose Admin or Bauherr.')
  if (id(fd) === c.user.id && s(fd, 'role') !== target.role) throw new Error('You cannot change your own role.')
  if (target.role === 'admin' && (s(fd, 'role') !== 'admin' || (id(fd) === c.user.id && !ids.length))) await assertAnotherAdmin(c.payload, id(fd))
  const login = s(fd, 'githubLogin').replace(/^@/, '')
  if (login && login !== target.githubLogin && !(await githubKnows(c, login))) throw Object.assign(new Error('GitHub login unknown.'), { data: { errors: [{ path: 'githubLogin', message: `GitHub does not know @${login}. Check the spelling.` }] } })
  await withLoginLock(target.email, () =>
    c.payload.update({ collection: 'bauherren', id: id(fd), data: { role: s(fd, 'role'), tenants: ids.map((tenant) => ({ tenant })), githubLogin: login || null, oidcSubject: s(fd, 'oidcSubject') || null }, ...c.w } as never)
  )
})

export const unlockBauherr = act({}, async (c, fd) => {
  only(c.user)
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  await withLoginLock(target.email, () => c.payload.update({ collection: 'bauherren', id: id(fd), data: { lockUntil: null, loginAttempts: 0 }, overrideAccess: true } as never))
})

export const createWorkspace = act({}, async (c, fd) => {
  only(c.user)
  const name = s(fd, 'name')
  const slug = slugOf(s(fd, 'slug') || name)
  if (!name) throw new Error('Name is required.')
  if (!slug) throw Object.assign(new Error('Slug is invalid.'), { data: { errors: [{ path: 'slug', message: 'Use letters or digits' }] } })
  const ws = await c.payload.create({ collection: 'workspaces', data: { name, slug }, ...c.w } as never)
  const me = await c.payload.findByID({ collection: 'bauherren', id: c.user.id as number, depth: 0, overrideAccess: true })
  const have = ((me.tenants ?? []) as { tenant: number | { id: number } }[]).map((t) => ({ tenant: typeof t.tenant === 'object' ? t.tenant.id : t.tenant }))
  await withLoginLock(me.email, () => c.payload.update({ collection: 'bauherren', id: me.id, data: { tenants: [...have, { tenant: ws.id as number }] }, overrideAccess: true } as never))
})

export const deleteWorkspace = act({}, async ({ user, workspace, payload }, fd) => {
  only(user)
  const id = inWorkspace({ workspace })
  if (s(fd, 'confirm') !== workspace?.name) throw new Error('Type the Workspace name to confirm.')
  await archiveWorkspace(payload, user, id)
})

export const restoreWorkspaceAction = act({}, async ({ user, payload }, fd) => {
  only(user)
  await restoreWorkspace(payload, user, id(fd))
})

export const mintOwnAgentKey = act({}, async ({ user, payload }, fd) => mintAgentKey(payload, user, s(fd, 'label')))

export const revokeOwnAgentKey = act({}, async ({ user, payload }, fd) => revokeAgentKey(payload, user, id(fd)))

export const rotateOwnKey = act({}, async ({ user, payload }) => rotateApiKey(payload, user))

export const revokeOwnKey = act({}, async ({ user, payload }) => revokeApiKey(payload, user))

