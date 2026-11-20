import { createLocalReq } from 'payload'
import { rotateKey } from '../../../lib/gateway'
import { refreshPrices } from '../../../lib/prices'
import { withLoginLock } from '../../../lib/login-lock'
import { archiveWorkspace, restoreWorkspace as restoreArchivedWorkspace } from '../../../lib/workspace-delete'
import { id, inWorkspace, s, type Ctx } from './action-context'
import { only, presetFor } from './settings'
import { slugOf } from './new-product'

const TIERS = ['cheap', 'standard', 'strong'] as const

export const saveGeneral = async ({ user, workspace, payload, w }: Ctx, fd: FormData) => {
  only(user)
  await payload.update({
    collection: 'workspaces',
    id: inWorkspace({ workspace }),
    data: { name: s(fd, 'name') },
    ...w,
  })
}

export const saveModels = async ({ user, workspace, payload, w }: Ctx, fd: FormData) => {
  only(user)
  const wsId = inWorkspace({ workspace })
  const unit = s(fd, 'budgetUnit') === 'tokens' ? 'tokens' : 'usd'
  const amount = s(fd, 'budgetAmount')
  const data: Record<string, unknown> = {
    budgetUnit: unit,
    [unit === 'usd' ? 'budgetUsd30d' : 'budgetTokens30d']: amount === '' ? null : Number(amount),
  }
  const { defaultModels: defaults, slugs } = await presetFor(wsId)
  const missing = TIERS.filter((t) => !s(fd, `tier_${t}`) && !defaults)
  if (missing.length)
    throw Object.assign(new Error('Model tiers missing.'), {
      data: {
        errors: missing.map((t) => ({ path: `tier_${t}`, message: 'This provider has no default; set a model id' })),
      },
    })
  const qualify = (v: string) => (!slugs.length || slugs.some((c) => v.startsWith(`${c}/`)) ? v : `${slugs[0]}/${v}`)
  const tiers = Object.fromEntries(TIERS.map((t) => [t, qualify(s(fd, `tier_${t}`) || defaults![t])]))
  data.modelByTier = tiers
  await payload.update({ collection: 'workspaces', id: wsId, data, ...w })
}

export const rotateWorkspaceKey = async ({ user, workspace, payload }: Ctx) => {
  only(user)
  await rotateKey(await createLocalReq({ user }, payload), inWorkspace({ workspace }))
}

export const updatePricesNow = async ({ user, payload }: Ctx) => {
  only(user)
  const status = await refreshPrices(payload, { force: true })
  if (status?.error) throw new Error(status.error.message)
  if (!status) throw new Error('Price updates are switched off on this instance (BAUHERR_PRICES_REFRESH=0).')
}

export const createWorkspace = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const name = s(fd, 'name')
  const slug = slugOf(s(fd, 'slug') || name)
  if (!name) throw new Error('Name is required.')
  if (!slug)
    throw Object.assign(new Error('Slug is invalid.'), {
      data: { errors: [{ path: 'slug', message: 'Use letters or digits' }] },
    })
  const ws = await c.payload.create({ collection: 'workspaces', data: { name, slug }, ...c.w })
  const me = (await c.payload.findByID({
    collection: 'bauherren',
    id: c.user.id,
    depth: 0,
    overrideAccess: true,
  })) as { id: number; email: string; tenants?: { tenant: number | { id: number } }[] | null }
  const have = (me.tenants ?? []).map((t) => ({
    tenant: typeof t.tenant === 'object' ? t.tenant.id : t.tenant,
  }))
  await withLoginLock(me.email, () =>
    c.payload.update({
      collection: 'bauherren',
      id: me.id,
      data: { tenants: [...have, { tenant: ws.id }] },
      overrideAccess: true,
    }),
  )
}

export const deleteWorkspace = async ({ user, workspace, payload }: Ctx, fd: FormData) => {
  only(user)
  const wsId = inWorkspace({ workspace })
  if (s(fd, 'confirm') !== workspace?.name) throw new Error('Type the Workspace name to confirm.')
  await archiveWorkspace(payload, user, wsId)
}

export const restoreWorkspace = async ({ user, payload }: Ctx, fd: FormData) => {
  only(user)
  await restoreArchivedWorkspace(payload, user, id(fd))
}
