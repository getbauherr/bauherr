import { isDeepStrictEqual } from 'node:util'
import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeValidateHook,
  type PayloadRequest,
} from 'payload'
import {
  DEFAULT_MODEL_BY_TIER,
  gatewayEnabled,
  removeProvider,
  renderModels,
  verifyProvider,
  writeProvider,
} from '../lib/gateway'
import { PRESETS, presetOf } from '../lib/providers'
import { decrypt } from '../lib/secrets'
import {
  assertAmbientAllowed,
  assertConfigComplete,
  assertProviderAllowed,
  type ConnectionDoc,
  type ConnectionFields,
  mergedConfig,
  mirroredFields,
  slugOf,
  workspaceIdOf,
} from './connection-validation'
import { llmConnections, TIERS, unitOf } from './llm-connections'

type WorkspaceDoc = {
  id: number | string
  slug: string
  gatewayKey: string
  modelByTier: Record<string, string> | null
  budgetUnit: string
}
type Preset = (typeof PRESETS)[keyof typeof PRESETS]

const workspaceOf = async (req: PayloadRequest, id: number | string): Promise<WorkspaceDoc> =>
  (await req.payload.findByID({
    collection: 'workspaces',
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })) as WorkspaceDoc

export const refuseDeleteWhileUsedByTier: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const doc = (await req.payload.findByID({
    collection: 'connections',
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })) as ConnectionDoc
  if (doc.kind !== 'llm-provider') return
  const ws = await workspaceOf(req, workspaceIdOf(doc.workspace as number | { id: number }))
  const used = TIERS.filter((t) => ws.modelByTier?.[t]?.startsWith(`${doc.slug}/`))
  if (used.length)
    throw new APIError(
      `Connection "${doc.slug}" is used by the tier(s) ${used.join(', ')}; point them at another Connection first`,
      400,
    )
}

export const validateConnection: CollectionBeforeValidateHook = async ({ data, originalDoc, req }) => {
  const original = originalDoc as ConnectionDoc | undefined
  const next = (data ?? {}) as ConnectionFields
  if ((next.kind ?? original?.kind) !== 'llm-provider') return data
  const config = mergedConfig(next, original)
  assertProviderAllowed(req, config, original)
  const slug = await slugOf(req, next, original, config)
  assertConfigComplete(next, config)
  await assertAmbientAllowed(req, config)
  return { ...data, ...mirroredFields(config), config, slug }
}

const tiersFor = (
  ws: WorkspaceDoc,
  conns: Awaited<ReturnType<typeof llmConnections>>,
  slug: string,
  preset: Preset,
  operation: string,
): Record<string, string | undefined> => {
  const own = (v?: string) => !!v?.startsWith(`${slug}/`)
  const nowhere = (v?: string) => !conns.some((c) => v?.startsWith(`${c.slug}/`))
  return Object.fromEntries(
    TIERS.map((t) => {
      const v = ws.modelByTier?.[t]
      if (own(v)) return [t, operation === 'update' && preset.defaultModels ? `${slug}/${preset.defaultModels[t]}` : v]
      return [t, nowhere(v) ? `${slug}/${preset.defaultModels?.[t] ?? v ?? DEFAULT_MODEL_BY_TIER[t]}` : v]
    }),
  )
}

const writeProviderFiles = async (
  req: PayloadRequest,
  preset: Preset,
  workspaceSlug: string,
  slug: string,
  secret: string | undefined,
): Promise<void> => {
  if (preset.auth === 'file' && secret) await writeProvider(workspaceSlug, slug, decrypt(secret), preset.secret.ext)
  await removeProvider(
    workspaceSlug,
    slug,
    ...(preset.auth === 'file'
      ? [preset.secret.ext === 'key' ? ('json' as const) : ('key' as const)]
      : (['key', 'json'] as const)),
  )
  await renderModels(req)
}

type Raw = {
  id: number | string
  secret?: string
  workspace: { id: number | string; slug: string }
  capabilities?: Record<string, unknown> | null
}

const syncWorkspaceTiers = async (
  req: PayloadRequest,
  change: { doc: ConnectionDoc; previous: ConnectionDoc | undefined; operation: string },
  context: { raw: Raw; ws: WorkspaceDoc; preset: Preset },
): Promise<Record<string, string | undefined> | undefined> => {
  const { doc, previous, operation } = change
  const { raw, ws, preset } = context
  const conns = await llmConnections(req, raw.workspace.id)
  const tiers = tiersFor(ws, conns, doc.slug as string, preset, operation)
  const changed = operation === 'create' || presetOf(previous?.config) !== presetOf(doc.config)
  const data: { budgetUnit?: string; modelByTier?: Record<string, string | undefined> } = {}
  if (changed && ws.budgetUnit !== unitOf(conns)) data.budgetUnit = unitOf(conns)
  if (changed && !isDeepStrictEqual(ws.modelByTier, tiers)) data.modelByTier = tiers
  if (Object.keys(data).length)
    await req.payload.update({
      collection: 'workspaces',
      id: raw.workspace.id,
      data,
      overrideAccess: true,
      req,
    })
  return data.modelByTier
}

const verifyAndRecord = async (
  req: PayloadRequest,
  doc: ConnectionDoc,
  context: { raw: Raw; ws: WorkspaceDoc; preset: Preset; current: Record<string, string> },
): Promise<void> => {
  const { raw, ws, preset, current } = context
  const slug = doc.slug as string
  const own = (v?: string) => !!v?.startsWith(`${slug}/`)
  const cheapest =
    TIERS.map((t) => current[t]).find(own) ?? `${slug}/${preset.defaultModels?.cheap ?? DEFAULT_MODEL_BY_TIER.cheap}`
  const result = await verifyProvider(raw.workspace.slug, decrypt(ws.gatewayKey), cheapest)
  req.context.skipVerify = true
  await req.payload.update({
    collection: 'connections',
    id: doc.id as number | string,
    data: { capabilities: { ...raw.capabilities, verifiedAt: undefined, lastError: undefined, ...result } },
    overrideAccess: true,
    req,
  })
}

export const publishConnection: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const saved = doc as ConnectionDoc
  if (saved.kind !== 'llm-provider' || req.context.skipVerify) return
  const raw = (await req.payload.findByID({
    collection: 'connections',
    id: saved.id as number | string,
    depth: 1,
    overrideAccess: true,
    req,
  })) as Raw
  const preset = PRESETS[presetOf(saved.config)]
  const ws = await workspaceOf(req, raw.workspace.id)
  const modelByTier = await syncWorkspaceTiers(
    req,
    { doc: saved, previous: previousDoc as ConnectionDoc | undefined, operation },
    { raw, ws, preset },
  )
  if (!gatewayEnabled()) return
  await writeProviderFiles(req, preset, raw.workspace.slug, saved.slug as string, raw.secret)
  if (!process.env.GATEWAY_URL) return
  const current = (modelByTier ?? ws.modelByTier) as Record<string, string>
  await verifyAndRecord(req, saved, { raw, ws, preset, current })
}

export const unpublishConnection: CollectionAfterDeleteHook = async ({ doc, req }) => {
  const deleted = doc as ConnectionDoc
  if (deleted.kind !== 'llm-provider') return
  const wsId = workspaceIdOf(deleted.workspace as number | { id: number })
  const ws = await workspaceOf(req, wsId)
  const conns = await llmConnections(req, wsId)
  if (conns.length && ws.budgetUnit !== unitOf(conns))
    await req.payload.update({
      collection: 'workspaces',
      id: wsId,
      data: { budgetUnit: unitOf(conns) },
      overrideAccess: true,
      req,
    })
  if (!gatewayEnabled()) return
  await removeProvider(ws.slug, deleted.slug as string)
  await renderModels(req)
}
