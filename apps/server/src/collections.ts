import type { CollectionConfig, Field } from 'payload'
import { DEFAULT_MODEL_BY_TIER, deleteKey, ensureKey, gatewayEnabled, newKey, removeProvider, renderModels, writeProvider } from './lib/gateway'
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
  auth: true,
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
    { name: 'modelByTier', type: 'json', defaultValue: DEFAULT_MODEL_BY_TIER },
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
          if (operation === 'create' || doc.budgetUsd30d !== previousDoc?.budgetUsd30d) await ensureKey(req, doc.id)
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

const connections = col(
  'connections',
  [
    text('name', { required: true }),
    select('kind', ['github', 'llm-provider'], { required: true }),
    json('config'),
    {
      name: 'secret',
      type: 'text',
      admin: { description: 'Write-only. Encrypted at rest; leave empty to keep the stored value.' },
      access: { read: () => false },
      hooks: {
        beforeChange: [({ value }) => (typeof value === 'string' && value && !isEncrypted(value) ? encrypt(value) : value)],
      },
    },
    json('capabilities'),
  ],
  {
    hooks: {
      afterChange: [
        async ({ doc, req }) => {
          if (doc.kind !== 'llm-provider' || !gatewayEnabled()) return
          const raw = (await req.payload.findByID({ collection: 'connections', id: doc.id, depth: 1, overrideAccess: true, req })) as unknown as {
            secret?: string
            workspace: { slug: string }
          }
          if (raw.secret) await writeProvider(raw.workspace.slug, decrypt(raw.secret))
          await renderModels(req)
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

export const runStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'needs_human', 'budget_exhausted']

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
    json('goal'),
    text('model'),
    num('tokensIn'),
    num('tokensOut'),
    num('tokensCache'),
    num('costEstimateUsd'),
    num('gatewayCostUsd'),
    select('costSource', ['estimate', 'gateway'], { defaultValue: 'estimate' }),
    select('reconcileStatus', ['pending', 'matched', 'mismatch'], { defaultValue: 'pending' }),
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
  ]),
  col('tool_calls', [
    text('toolUseId'),
    rel('step', 'steps', { required: true }),
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
