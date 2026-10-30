import { isDeepStrictEqual } from 'node:util'
import { ValidationError, type CollectionConfig, type Field } from 'payload'
import { DEFAULT_MODEL_BY_TIER, deleteKey, ensureKey, gatewayEnabled, newKey, removeProvider, renderModels, verifyProvider, writeProvider } from './lib/gateway'
import { missingFields, PRESETS, presetOf, type Preset } from './lib/providers'
import { decrypt, encrypt, isEncrypted } from './lib/secrets'

export const isAdmin = ({ req }: { req: { user?: object | null } }): boolean => (req.user as { role?: string } | null)?.role === 'admin'

const rel = (name: string, to: string, extra: Partial<Field> = {}): Field =>
  ({ name, type: 'relationship', relationTo: to, ...extra }) as Field
const text = (name: string, extra: Partial<Field> = {}): Field => ({ name, type: 'text', ...extra }) as Field
const num = (name: string): Field => ({ name, type: 'number' })
const date = (name: string): Field => ({ name, type: 'date' })
const json = (name: string): Field => ({ name, type: 'json' })
const select = (name: string, options: string[], extra: Partial<Field> = {}): Field =>
  ({ name, type: 'select', options, ...extra }) as Field

const col = (slug: string, fields: Field[], extra: Partial<CollectionConfig> = {}): CollectionConfig => ({
  slug,
  admin: { useAsTitle: (fields[0] as { name: string }).name },
  fields,
  ...extra,
})

const bauherren: CollectionConfig = {
  slug: 'bauherren',
  labels: { singular: 'Bauherr', plural: 'Bauherren' },
  auth: { useAPIKey: true },
  admin: { useAsTitle: 'email' },
  access: {
    create: isAdmin,
    delete: isAdmin,
    read: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
    update: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation === 'create' && (await req.payload.count({ collection: 'bauherren' })).totalDocs === 0) {
          data.role = 'admin'
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: ['admin', 'bauherr'],
      defaultValue: 'bauherr',
      required: true,
      access: { create: isAdmin, update: isAdmin },
    },
    text('githubLogin', { admin: { description: 'Assigned to Tickets when this Bauherr claims a session Run (falls back to BAUHERR_BOT_LOGIN).' } }),
  ],
}

const workspaces = col(
  'workspaces',
  [
    text('name', { required: true }),
    text('slug', { required: true, unique: true }),
    {
      name: 'gatewayKey',
      type: 'text',
      admin: { description: 'Write-only. Consumer key at the gateway; generated on create, encrypted at rest.' },
      access: { read: () => false },
      hooks: {
        beforeChange: [
          ({ value, operation }) =>
            operation === 'create' && !value ? encrypt(newKey()) : typeof value === 'string' && value && !isEncrypted(value) ? encrypt(value) : value,
        ],
      },
    },
    { name: 'budgetUsd30d', type: 'number', defaultValue: 50, min: 0 },
    select('budgetUnit', ['usd', 'tokens'], { defaultValue: 'usd', admin: { description: 'Flips to tokens when the provider has no USD price catalog.' } }),
    { name: 'budgetTokens30d', type: 'number', defaultValue: 20000000, min: 0 },
    { name: 'modelByTier', type: 'json', defaultValue: DEFAULT_MODEL_BY_TIER },
    select('defaultMode', ['session', 'autonomous'], { admin: { description: 'Run mode for all stages; empty = BAUHERR_DEFAULT_MODE, then pack/workflow.yaml, then autonomous.' } }),
    { name: 'modeByStage', type: 'json', admin: { description: 'Per-stage override, e.g. {"plan":"session","build":"session"}.' } },
  ],
  {
    access: {
      create: isAdmin,
      delete: isAdmin,
      read: ({ req }) =>
        req.user?.role === 'admin'
          ? true
          : { id: { in: ((req.user?.tenants as { tenant: { id: number } | number }[]) ?? []).map((t) => (typeof t.tenant === 'object' ? t.tenant.id : t.tenant)) } },
    },
    hooks: {
      afterChange: [
        async ({ doc, previousDoc, operation, req }) => {
          if (!gatewayEnabled()) return
          if (
            operation === 'create' ||
            (['budgetUsd30d', 'budgetUnit', 'budgetTokens30d'] as const).some((k) => doc[k] !== previousDoc?.[k])
          )
            await ensureKey(req, doc.id)
        },
      ],
      afterDelete: [
        async ({ doc, req }) => {
          if (!gatewayEnabled()) return
          await deleteKey(doc.slug)
          await removeProvider(doc.slug)
          await renderModels(req)
        },
      ],
    },
  },
)

const PRESET_FIELDS = ['baseUrl', 'awsRegion', 'vertexProject', 'vertexRegion', 'azureResource'] as const
const presetField = (name: (typeof PRESET_FIELDS)[number]): Field =>
  text(name, { admin: { condition: (data: Record<string, any>) => PRESETS[(data.provider as Preset) ?? 'anthropic'].required.includes(name) } })

const connections = col(
  'connections',
  [
    text('name', { required: true }),
    select('kind', ['github', 'llm-provider'], { required: true }),
    json('config'),
    select('provider', Object.keys(PRESETS), {
      defaultValue: 'anthropic',
      admin: {
        description: Object.entries(PRESETS)
          .map(([k, v]) => `${k}: ${v.secret.hint}`)
          .join('\n'),
      },
    }),
    ...PRESET_FIELDS.map(presetField),
    {
      name: 'secret',
      type: 'text',
      admin: { description: 'Write-only. Encrypted at rest; leave empty to keep the stored value. What to paste: see the provider hint.' },
      access: { read: () => false },
      hooks: {
        beforeChange: [({ value }) => (typeof value === 'string' && value && !isEncrypted(value) ? encrypt(value) : value)],
      },
    },
    json('capabilities'),
  ],
  {
    hooks: {
      beforeValidate: [
        ({ data, originalDoc }) => {
          if ((data?.kind ?? originalDoc?.kind) !== 'llm-provider') return data
          const config = { ...originalDoc?.config, ...data?.config } as Record<string, string>
          // The top-level field wins only when this request changed it; otherwise an explicit `config` value stands (API, seed).
          for (const k of ['provider', ...PRESET_FIELDS]) {
            const prev = originalDoc?.[k] ?? (k === 'provider' ? 'anthropic' : undefined)
            if (data?.[k] != null && data[k] !== prev) config[k] = data[k]
          }
          const missing = missingFields(presetOf(config), config)
          if (missing.length) {
            throw new ValidationError({ collection: 'connections', errors: missing.map((path) => ({ path, message: `required for ${presetOf(config)}` })) })
          }
          const mirrored = Object.fromEntries(['provider', ...PRESET_FIELDS].filter((k) => config[k] !== undefined).map((k) => [k, config[k]]))
          return { ...data, ...mirrored, config }
        },
      ],
      afterChange: [
        async ({ doc, previousDoc, operation, req }) => {
          if (doc.kind !== 'llm-provider' || !gatewayEnabled() || req.context.skipVerify) return
          const raw = (await req.payload.findByID({ collection: 'connections', id: doc.id, depth: 1, overrideAccess: true, req })) as unknown as {
            secret?: string
            workspace: { id: number | string; slug: string }
            capabilities?: Record<string, unknown> | null
          }
          const preset = PRESETS[presetOf(doc.config)]
          const o = { overrideAccess: true, req } as const
          if (raw.secret) await writeProvider(raw.workspace.slug, decrypt(raw.secret), preset.secret.ext)
          await removeProvider(raw.workspace.slug, preset.secret.ext === 'key' ? 'json' : 'key')
          await renderModels(req)
          const ws = (await req.payload.findByID({ collection: 'workspaces', id: raw.workspace.id, depth: 0, ...o })) as unknown as {
            gatewayKey: string
            modelByTier: Record<string, string>
            budgetUnit: string
          }
          // Preset change (or first Connection) sets the budget unit and, when the preset has defaults, the tiers.
          const changed = operation === 'create' || presetOf(previousDoc?.config) !== presetOf(doc.config)
          const data: Record<string, unknown> = {}
          const unit = preset.catalog ? 'usd' : 'tokens'
          if (changed && ws.budgetUnit !== unit) data.budgetUnit = unit
          if (changed && preset.defaultModels && !isDeepStrictEqual(ws.modelByTier, preset.defaultModels)) data.modelByTier = preset.defaultModels
          if (Object.keys(data).length) await req.payload.update({ collection: 'workspaces', id: raw.workspace.id, data, ...o })
          if (!process.env.GATEWAY_URL) return
          const cheap = { ...DEFAULT_MODEL_BY_TIER, ...ws.modelByTier, ...data.modelByTier as object }.cheap
          const result = await verifyProvider(raw.workspace.slug, decrypt(ws.gatewayKey), cheap)
          req.context.skipVerify = true
          await req.payload.update({
            collection: 'connections',
            id: doc.id,
            data: { capabilities: { ...raw.capabilities, verifiedAt: undefined, lastError: undefined, ...result } },
            ...o,
          })
        },
      ],
      afterDelete: [
        async ({ doc, req }) => {
          if (doc.kind !== 'llm-provider' || !gatewayEnabled()) return
          const ws = await req.payload.findByID({ collection: 'workspaces', id: typeof doc.workspace === 'object' ? doc.workspace.id : doc.workspace, depth: 0, overrideAccess: true, req })
          await removeProvider(ws.slug)
          await renderModels(req)
        },
      ],
    },
  },
)

const tickets = col('tickets', [
  text('title', { required: true }),
  rel('product', 'products', { required: true }),
  text('externalId', { required: true, index: true }),
  num('number'),
  text('url'),
  select('state', ['open', 'closed']),
  text('labels', { hasMany: true }),
  text('assignee'),
  date('sourceUpdatedAt'),
  text('stage', { index: true }),
  rel('parent', 'tickets'),
  rel('blockedBy', 'tickets', { hasMany: true }),
])

export const runStatuses = ['queued', 'awaiting_session', 'running', 'succeeded', 'failed', 'cancelled', 'needs_human', 'budget_exhausted']

export const collections: CollectionConfig[] = [
  bauherren,
  workspaces,
  col('products', [text('name', { required: true }), text('slug', { required: true })]),
  connections,
  col('repositories', [text('fullName', { required: true }), rel('product', 'products', { required: true })]),
  col('ticket_sources', [
    text('repo', { required: true }),
    rel('product', 'products', { required: true }),
    rel('connection', 'connections', { required: true }),
    text('cursor'),
  ]),
  tickets,
  col('runs', [
    rel('ticket', 'tickets', { required: true }),
    select('stage', ['plan', 'build'], { required: true }),
    select('status', runStatuses, { required: true, defaultValue: 'queued' }),
    select('mode', ['session', 'autonomous'], { required: true, defaultValue: 'autonomous' }),
    rel('sessionOwner', 'bauherren'),
    date('heartbeatAt'),
    text('evidence'),
    json('goal'),
    text('model'),
    num('tokensIn'),
    num('tokensOut'),
    num('tokensCache'),
    num('costEstimateUsd'),
    num('gatewayCostUsd'),
    num('gatewayTokensIn'),
    num('gatewayTokensOut'),
    num('gatewayTokensTotal'),
    select('costSource', ['sdk-estimate', 'gateway'], { defaultValue: 'sdk-estimate' }),
    select('reconcileStatus', ['pending', 'matched', 'mismatch', 'unavailable'], { defaultValue: 'pending' }),
    // The money figure the UI shows: gateway cost when reconciled, else the SDK estimate.
    {
      name: 'costUsd',
      type: 'number',
      virtual: true,
      hooks: { afterRead: [({ siblingData }) => siblingData.gatewayCostUsd ?? siblingData.costEstimateUsd ?? null] },
    },
    date('startedAt'),
    date('finishedAt'),
    text('error'),
    json('artifacts'),
  ]),
  col('steps', [
    rel('run', 'runs', { required: true }),
    num('seq'),
    text('messageId'),
    num('tokensIn'),
    num('tokensOut'),
    num('costEstimateUsd'),
    date('startedAt'),
    text('summary'),
  ]),
  col('tool_calls', [
    text('toolUseId'),
    rel('step', 'steps'),
    rel('run', 'runs'),
    text('name'),
    text('inputDigest'),
    select('status', ['ok', 'error']),
    num('durationMs'),
  ]),
  col('human_touches', [
    text('kind'),
    rel('ticket', 'tickets', { required: true }),
    rel('run', 'runs'),
    text('actor'),
    date('at'),
  ]),
  col('workflow_versions', [
    num('version'),
    rel('product', 'products', { required: true }),
    json('compiled'),
  ]),
]
