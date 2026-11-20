import {
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeValidateHook,
  type PayloadRequest,
  ValidationError,
} from 'payload'
import { deleteKey, ensureKey, gatewayEnabled, removeWorkspaceProviders, renderModels } from '../lib/gateway'
import { PRESETS, type Preset } from '../lib/providers'
import { llmConnections, sharedIdentity } from './llm-connections'
import { lockAmbient } from './locks'

const BUDGET_FIELDS = ['budgetUsd30d', 'budgetUnit', 'budgetTokens30d'] as const

const workspaceError = (errors: { path: string; message: string }[]) =>
  new ValidationError({ collection: 'workspaces', errors })

const assertModelsNameConnections = async (
  req: PayloadRequest,
  workspace: number | string,
  modelByTier: Record<string, string>,
): Promise<void> => {
  const slugs = (await llmConnections(req, workspace)).map((c) => c.slug as string)
  const bad = Object.entries(modelByTier).filter(
    ([, v]) => !slugs.some((s) => String(v).startsWith(`${s}/`) && String(v).length > s.length + 1),
  )
  if (slugs.length && bad.length) {
    throw workspaceError(
      bad.map(([path]) => ({
        path,
        message: `must be <connection>/<model>, connection one of: ${slugs.join(', ')}`,
      })),
    )
  }
}

const assertNoAmbientConnection = async (req: PayloadRequest): Promise<void> => {
  await lockAmbient(req)
  const ambient = Object.keys(PRESETS).filter((k) => sharedIdentity(k as Preset))
  const found = await req.payload.count({
    collection: 'connections',
    where: { kind: { equals: 'llm-provider' }, provider: { in: ambient } },
    overrideAccess: true,
    req,
  })
  if (found.totalDocs) {
    throw workspaceError([
      {
        path: 'name',
        message:
          'a Connection uses the gateway ambient identity, shared by the whole gateway: ' +
          'no second Workspace allowed',
      },
    ])
  }
}

export const validateWorkspace: CollectionBeforeValidateHook = async ({ data, operation, originalDoc, req }) => {
  if (operation === 'update') {
    const modelByTier = data?.modelByTier as Record<string, string> | undefined
    if (!modelByTier) return
    await assertModelsNameConnections(req, (originalDoc as { id: number | string }).id, modelByTier)
    return
  }
  if (operation !== 'create') return
  await assertNoAmbientConnection(req)
}

export const syncGatewayKey: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (!gatewayEnabled()) return
  const before = previousDoc as Record<string, unknown> | undefined
  const after = doc as Record<string, unknown> & { id: number | string }
  if (operation === 'create' || BUDGET_FIELDS.some((k) => after[k] !== before?.[k])) await ensureKey(req, after.id)
}

export const dropGatewayKey: CollectionAfterDeleteHook = async ({ doc, req }) => {
  if (!gatewayEnabled()) return
  const { slug } = doc as { slug: string }
  await deleteKey(slug)
  await removeWorkspaceProviders(slug)
  await renderModels(req)
}
