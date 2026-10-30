'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createLocalReq } from 'payload'
import { revokeApiKey, rotateApiKey } from '../../../../lib/api-key'
import { rotateKey } from '../../../../lib/gateway'
import { PRESET_FIELDS } from '../../../../lib/providers'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../../../../lib/settings-guards'
import { isAdmin, only, presetFor, run, type FormState } from '../../lib/settings'
import { currentWorkspace, payloadClient, workspacesOf } from '../../lib/session'

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
    if (result.saved) revalidatePath('/settings', 'layout')
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
  const defaults = (await presetFor(wsId)).defaultModels
  const missing = (['cheap', 'standard', 'strong'] as const).filter((t) => !s(fd, `tier_${t}`) && !defaults)
  if (missing.length) throw Object.assign(new Error('Model tiers missing.'), { data: { errors: missing.map((t) => ({ path: `tier_${t}`, message: 'This provider has no default; set a model id' })) } })
  const tiers = Object.fromEntries((['cheap', 'standard', 'strong'] as const).map((t) => [t, s(fd, `tier_${t}`) || defaults![t]]))
  const data: Record<string, unknown> = { budgetUnit: unit, [unit === 'usd' ? 'budgetUsd30d' : 'budgetTokens30d']: amount === '' ? null : Number(amount), modelByTier: tiers }
  if (isAdmin(user)) {
    const stages = Object.fromEntries(['plan', 'build'].map((t) => [t, s(fd, `mode_${t}`)]).filter(([, v]) => v))
    Object.assign(data, { name: s(fd, 'name'), defaultMode: s(fd, 'defaultMode') || null, modeByStage: Object.keys(stages).length ? stages : null })
  } else if (!(await workspacesOf(user)).some((x) => x.id === wsId)) throw new Error('Not your Workspace.')
  await payload.update({ collection: 'workspaces', id: wsId, data, ...w } as never)
})

export const rotateWorkspaceKey = act({}, async ({ user, workspace, payload }) => {
  only(user)
  await rotateKey(await createLocalReq({ user }, payload), inWorkspace({ workspace }))
})

const inWs = (c: Awaited<ReturnType<typeof ctx>>, collection: string, ...ids: (number | undefined)[]) => assertInWorkspace(c.payload, collection, ids, inWorkspace(c))

const create = (collection: string, build: (fd: FormData) => Record<string, unknown>) =>
  act({}, async (c, fd) => {
    only(c.user)
    await c.payload.create({ collection, data: { ...build(fd), workspace: inWorkspace(c) }, ...c.w } as never)
  })

export const createProduct = create('products', (fd) => ({ name: s(fd, 'name'), slug: s(fd, 'slug') }))
export const createRepository = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  await c.payload.create({ collection: 'repositories', data: { fullName: s(fd, 'fullName'), product: id(fd), workspace: inWorkspace(c) }, ...c.w } as never)
})
export const createSource = act({}, async (c, fd) => {
  only(c.user)
  const connection = Number(s(fd, 'connection')) || undefined
  await inWs(c, 'products', id(fd))
  await inWs(c, 'connections', connection)
  await c.payload.create({ collection: 'ticket_sources', data: { repo: s(fd, 'repo'), connection, product: id(fd), workspace: inWorkspace(c) }, ...c.w } as never)
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
})

export const saveConnection = act({}, async (c, fd) => {
  only(c.user)
  const kind = s(fd, 'kind')
  const data: Record<string, unknown> = { name: s(fd, 'name'), kind }
  if (kind === 'llm-provider') {
    data.provider = s(fd, 'provider')
    for (const k of PRESET_FIELDS) if (fd.has(k)) data[k] = s(fd, k)
  }
  if (s(fd, 'secret')) data.secret = s(fd, 'secret')
  if (id(fd)) {
    await inWs(c, 'connections', id(fd))
    await c.payload.update({ collection: 'connections', id: id(fd), data, ...c.w } as never)
  } else await c.payload.create({ collection: 'connections', data: { ...data, workspace: inWorkspace(c) }, ...c.w } as never)
})

/** Re-saves unchanged: the afterChange hook verifies the provider again. */
export const verifyConnection = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'connections', id(fd))
  await c.payload.update({ collection: 'connections', id: id(fd), data: {}, ...c.w } as never)
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

/** Own record only: the target is always the signed-in Bauherr, never a form value. The key appears once, as the ready-made `claude mcp add` line. */
export const rotateOwnKey = act({}, async ({ user, payload }) => {
  const key = await rotateApiKey(payload, user.id)
  const h = await headers()
  const origin = process.env.PUBLIC_URL ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`
  return `claude mcp add --transport http bauherr ${origin}/mcp --header "Authorization: Bearer ${key}"`
})

export const revokeOwnKey = act({}, async ({ user, payload }) => revokeApiKey(payload, user.id))
