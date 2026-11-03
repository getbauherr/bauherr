'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createLocalReq } from 'payload'
import { mintAgentKey, revokeAgentKey, revokeApiKey, rotateApiKey } from '../../../../lib/api-key'
import { backendFor } from '../../../../lib/adapters'
import { connectionInput, webOrigin } from '../../../../lib/connection'
import { createEmbedToken } from '../../../../lib/intake/embed'
import { unknownLogins } from '../../../../lib/gates'
import { rotateKey } from '../../../../lib/gateway'
import { PRESET_FIELDS } from '../../../../lib/providers'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../../../../lib/settings-guards'
import { deployErrors } from '../../lib/product-setup'
import { isAdmin, only, presetFor, run, type FormState } from '../../lib/settings'
import { currentWorkspace, payloadClient, workspacesOf } from '../../lib/session'
import { isWebUrl } from '../../lib/url'
import { WIP_STAGES } from '../../../../lib/wip-limits'

type Form = (prev: FormState, fd: FormData) => Promise<FormState>

/** Writes go through the local API as the signed-in Bauherr with access control on, so Payload's validation and access rules apply exactly as on /api. */
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
      revalidatePath('/setup')
    }
    return result
  }
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()
const id = (fd: FormData) => Number(fd.get('id'))
const inWorkspace = (c: { workspace: { id: number } | null }) => {
  if (!c.workspace) throw new Error('No Workspace selected.')
  return c.workspace.id
}

export const saveWorkspace = act({ budgetUsd30d: 'budgetAmount', budgetTokens30d: 'budgetAmount' }, async ({ user, workspace, payload, w }, fd) => {
  const wsId = inWorkspace({ workspace })
  const unit = s(fd, 'budgetUnit') === 'tokens' ? 'tokens' : 'usd'
  const amount = s(fd, 'budgetAmount')
  const data: Record<string, unknown> = { budgetUnit: unit, [unit === 'usd' ? 'budgetUsd30d' : 'budgetTokens30d']: amount === '' ? null : Number(amount) }
  if (isAdmin(user)) {
    const { defaultModels: defaults, slugs } = await presetFor(wsId)
    const missing = (['cheap', 'standard', 'strong'] as const).filter((t) => !s(fd, `tier_${t}`) && !defaults)
    if (missing.length) throw Object.assign(new Error('Model tiers missing.'), { data: { errors: missing.map((t) => ({ path: `tier_${t}`, message: 'This provider has no default; set a model id' })) } })
    // Tiers are `<connection>/<model>`; a bare model id goes to the first Connection.
    const qualify = (v: string) => (!slugs.length || slugs.some((c) => v.startsWith(`${c}/`)) ? v : `${slugs[0]}/${v}`)
    const tiers = Object.fromEntries((['cheap', 'standard', 'strong'] as const).map((t) => [t, qualify(s(fd, `tier_${t}`) || defaults![t])]))
    const conn = Number(s(fd, 'knowledgeConnection')) || undefined
    await assertInWorkspace(payload, 'connections', [conn], wsId)
    const stages = Object.fromEntries(['plan', 'build'].map((t) => [t, s(fd, `mode_${t}`)]).filter(([, v]) => v))
    Object.assign(data, { modelByTier: tiers, name: s(fd, 'name'), defaultMode: s(fd, 'defaultMode') || null, modeByStage: Object.keys(stages).length ? stages : null, knowledgeConnection: conn ?? null, knowledgeRepo: s(fd, 'knowledgeRepo') || null })
  } else if (!(await workspacesOf(user)).some((x) => x.id === wsId)) throw new Error('Not your Workspace.')
  await payload.update({ collection: 'workspaces', id: wsId, data, ...w } as never)
})

/** WIP limits per Board column: a whole number of at least 1, empty for no limit. */
export const saveWipLimits = act({}, async ({ user, workspace, payload, w }, fd) => {
  only(user)
  const wsId = inWorkspace({ workspace })
  const limits: Record<string, number> = {}
  for (const stage of WIP_STAGES) {
    const v = s(fd, `wip_${stage}`)
    if (v === '') continue
    if (!/^[1-9]\d*$/.test(v)) throw Object.assign(new Error('Invalid limit.'), { data: { errors: [{ path: `wip_${stage}`, message: 'A whole number of at least 1, or empty for no limit' }] } })
    limits[stage] = Number(v)
  }
  await payload.update({ collection: 'workspaces', id: wsId, data: { wipLimits: limits }, ...w } as never)
})

export const rotateWorkspaceKey = act({}, async ({ user, workspace, payload }) => {
  only(user)
  await rotateKey(await createLocalReq({ user }, payload), inWorkspace({ workspace }))
})

const inWs = (c: Awaited<ReturnType<typeof ctx>>, collection: string, ...ids: (number | undefined)[]) => assertInWorkspace(c.payload, collection, ids, inWorkspace(c))

const slugOf = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Creates the Product (short name derived from the name when empty) and returns its id. */
const makeProduct = async (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => {
  const name = s(fd, 'name')
  const slug = s(fd, 'slug') || slugOf(name)
  if (!/^[a-z0-9-]+$/.test(slug)) throw Object.assign(new Error('Short name invalid.'), { data: { errors: [{ path: 'slug', message: 'Use lowercase letters, digits and dashes.' }] } })
  return (await c.payload.create({ collection: 'products', data: { name, slug, workspace: inWorkspace(c) }, ...c.w } as never)).id as number
}

/** Creates the Product and opens its page. */
export const createProduct = act({}, async (c, fd) => {
  only(c.user)
  redirect(`/settings/products/${await makeProduct(c, fd)}`)
})

export const saveDeploy = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const data = { stagingUrl: s(fd, 'stagingUrl'), deployMode: s(fd, 'deployMode'), deployWebhookUrl: s(fd, 'deployWebhookUrl'), deployChecks: s(fd, 'deployChecks'), gateOwners: s(fd, 'gateOwners'), autoMerge: fd.get('autoMerge') === 'on', productionGate: fd.get('productionGate') === 'on', productionWebhookUrl: s(fd, 'productionWebhookUrl'), productionChecks: s(fd, 'productionChecks'), releaseMode: s(fd, 'releaseMode') }
  const errors = Object.entries(deployErrors(data)).map(([path, message]) => ({ path, message }))
  const unknown = await unknownLogins(c.payload, id(fd), data.gateOwners)
  if (unknown.length) errors.push({ path: 'gateOwners', message: `GitHub does not know ${unknown.map((l) => `@${l}`).join(', ')}. Check the spelling.` })
  if (errors.length) throw Object.assign(new Error('Release settings invalid.'), { data: { errors } })
  await c.payload.update({ collection: 'products', id: id(fd), data, ...c.w } as never)
})

/** Adds a repository to a Product; "Read tickets" also adds its ticket source (the repository is removed again if that fails). */
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

/** Product, repository and ticket source in one go; the Product is deleted again when a later create fails. */
export const createProductWithRepo = act({}, async (c, fd) => {
  only(c.user)
  const product = await makeProduct(c, fd)
  fd.set('readTickets', 'on')
  try {
    await makeRepository(c, product, fd)
  } catch (e) {
    await c.payload.delete({ collection: 'products', id: product, ...c.w } as never)
    throw e
  }
})

/** "Skip, use defaults" on /setup: a save without changes, which marks the Product's staging and gates as seen. */
export const skipDeploy = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  await c.payload.update({ collection: 'products', id: id(fd), data: { deployMode: 'observe-ci' }, ...c.w } as never)
})

/** The token is shown once as the ready-made script tag; only its hash is stored. */
export const mintEmbedToken = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const allowedOrigins = s(fd, 'origins').split(/[\s,]+/).filter(Boolean)
  if (!allowedOrigins.length) throw Object.assign(new Error('Origins missing.'), { data: { errors: [{ path: 'origins', message: 'Add at least one origin' }] } })
  if (!allowedOrigins.every(isWebUrl)) throw Object.assign(new Error('Origins invalid.'), { data: { errors: [{ path: 'origins', message: 'Each origin must be an http(s) URL' }] } })
  const token = await createEmbedToken(c.payload, { product: id(fd), name: s(fd, 'name'), allowedOrigins })
  return `<script src="${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/intake/widget.js" data-token="${token}"></script>`
})
export const revokeEmbedToken = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'embed_tokens', id(fd))
  await c.payload.update({ collection: 'embed_tokens', id: id(fd), data: { revokedAt: new Date().toISOString() }, overrideAccess: true } as never)
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
  if (kind === 'gitlab') data.config = { baseUrl: webOrigin({ kind, config: { baseUrl: s(fd, 'baseUrl') } }) }
  if (s(fd, 'secret')) data.secret = s(fd, 'secret')
  if (id(fd)) {
    await inWs(c, 'connections', id(fd))
    if (kind !== 'llm-provider' && s(fd, 'secret')) data.capabilities = {}
    await c.payload.update({ collection: 'connections', id: id(fd), data, ...c.w } as never)
  } else await c.payload.create({ collection: 'connections', data: { ...data, workspace: inWorkspace(c) }, ...c.w } as never)
})

/** LLM providers: re-saves unchanged, the afterChange hook verifies the provider again. Forges: asks the forge who the token belongs to and stores the outcome in `capabilities`. */
export const verifyConnection = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'connections', id(fd))
  const conn = await connectionInput(c.payload, id(fd))
  if (conn.kind === 'llm-provider') {
    await c.payload.update({ collection: 'connections', id: id(fd), data: {}, ...c.w } as never)
    return
  }
  const lastError = await backendFor(conn).tickets('').whoami().then(() => null, (e: Error) => e.message)
  await c.payload.update({ collection: 'connections', id: id(fd), data: { capabilities: { ...conn.capabilities, verifiedAt: lastError ? null : new Date().toISOString(), lastError } }, overrideAccess: true } as never)
  if (lastError) throw new Error(`The forge did not accept the token: ${lastError}`)
})

const tenants = (fd: FormData) => fd.getAll('workspaces').map(Number)
const known = async (c: Awaited<ReturnType<typeof ctx>>, ids: number[]) => {
  const own = (await workspacesOf(c.user)).map((w) => w.id)
  if (ids.some((i) => !own.includes(i))) throw new Error('Not in this Workspace')
}
export const createBauherr = act({}, async (c, fd) => {
  only(c.user)
  await known(c, tenants(fd))
  const password = randomBytes(12).toString('base64url')
  await c.payload.create({ collection: 'bauherren', data: { email: s(fd, 'email'), password, role: s(fd, 'role'), tenants: tenants(fd).map((tenant) => ({ tenant })) }, ...c.w } as never)
  return `Temporary password (shown once): ${password}`
})

export const saveBauherr = act({}, async (c, fd) => {
  only(c.user)
  const ids = tenants(fd)
  await known(c, ids)
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  if (target.role === 'admin' && (s(fd, 'role') !== 'admin' || (id(fd) === c.user.id && !ids.length))) await assertAnotherAdmin(c.payload, id(fd))
  await c.payload.update({ collection: 'bauherren', id: id(fd), data: { role: s(fd, 'role'), tenants: ids.map((tenant) => ({ tenant })), oidcSubject: s(fd, 'oidcSubject') || null }, ...c.w } as never)
})

const mcpAdd = (key: string) => `claude mcp add --transport http bauherr ${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/mcp --header "Authorization: Bearer ${key}"`

/** Own record only: the target is always the signed-in Bauherr, never a form value. The key appears once, as the ready-made `claude mcp add` line. */
export const mintOwnAgentKey = act({}, async ({ user, payload }, fd) => mcpAdd(await mintAgentKey(payload, user, s(fd, 'label'))))

export const revokeOwnAgentKey = act({}, async ({ user, payload }, fd) => revokeAgentKey(payload, user, id(fd)))

/** The personal (human) key: for scripted owner use only, it can approve gates. */
export const rotateOwnKey = act({}, async ({ user, payload }) => mcpAdd(await rotateApiKey(payload, user)))

export const revokeOwnKey = act({}, async ({ user, payload }) => revokeApiKey(payload, user))
