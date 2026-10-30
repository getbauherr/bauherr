'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createLocalReq } from 'payload'
import { rotateKey } from '../../../../lib/gateway'
import { blockedBy, isAdmin, only, run, type FormState } from '../../lib/settings'
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
    const result = await run(async () => fn(await ctx(), fd), rename)
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
  const tiers = Object.fromEntries(['cheap', 'standard', 'strong'].map((t) => [t, s(fd, `tier_${t}`)]).filter(([, v]) => v))
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

const create = (collection: string, build: (fd: FormData) => Record<string, unknown>) =>
  act({}, async (c, fd) => {
    only(c.user)
    await c.payload.create({ collection, data: { ...build(fd), workspace: inWorkspace(c) }, ...c.w } as never)
  })

export const createProduct = create('products', (fd) => ({ name: s(fd, 'name'), slug: s(fd, 'slug') }))
export const createRepository = create('repositories', (fd) => ({ fullName: s(fd, 'fullName'), product: id(fd) }))
export const createSource = create('ticket_sources', (fd) => ({ repo: s(fd, 'repo'), connection: Number(s(fd, 'connection')) || undefined, product: id(fd) }))

const COLLECTIONS = ['products', 'repositories', 'ticket_sources', 'bauherren']
export const removeDoc = act({}, async (c, fd) => {
  only(c.user)
  const collection = s(fd, 'collection')
  if (!COLLECTIONS.includes(collection)) throw new Error('Unknown collection.')
  if (collection === 'bauherren' && id(fd) === c.user.id) throw new Error('You cannot remove yourself.')
  if (collection === 'products') {
    const blocked = await blockedBy('products', id(fd))
    if (blocked) throw new Error(`Still referenced by ${blocked}.`)
  }
  await c.payload.delete({ collection, id: id(fd), ...c.w } as never)
})

const PRESET_FIELDS = ['baseUrl', 'awsRegion', 'vertexProject', 'vertexRegion', 'azureResource']
export const saveConnection = act({}, async (c, fd) => {
  only(c.user)
  const kind = s(fd, 'kind')
  const data: Record<string, unknown> = { name: s(fd, 'name'), kind }
  if (kind === 'llm-provider') {
    data.provider = s(fd, 'provider')
    for (const k of PRESET_FIELDS) if (fd.has(k)) data[k] = s(fd, k)
  }
  if (s(fd, 'secret')) data.secret = s(fd, 'secret')
  if (id(fd)) await c.payload.update({ collection: 'connections', id: id(fd), data, ...c.w } as never)
  else await c.payload.create({ collection: 'connections', data: { ...data, workspace: inWorkspace(c) }, ...c.w } as never)
})

/** Re-saves unchanged: the afterChange hook verifies the provider again. */
export const verifyConnection = act({}, async (c, fd) => {
  only(c.user)
  await c.payload.update({ collection: 'connections', id: id(fd), data: {}, ...c.w } as never)
})

const tenants = (fd: FormData) => fd.getAll('workspaces').map((v) => ({ tenant: Number(v) }))
export const createBauherr = act({}, async (c, fd) => {
  only(c.user)
  const password = randomBytes(12).toString('base64url')
  await c.payload.create({ collection: 'bauherren', data: { email: s(fd, 'email'), password, role: s(fd, 'role'), tenants: tenants(fd) }, ...c.w } as never)
  return `Temporary password (shown once): ${password}`
})

export const saveBauherr = act({}, async (c, fd) => {
  only(c.user)
  await c.payload.update({ collection: 'bauherren', id: id(fd), data: { role: s(fd, 'role'), tenants: tenants(fd), oidcSubject: s(fd, 'oidcSubject') || null }, ...c.w } as never)
})
