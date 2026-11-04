import { isDeepStrictEqual } from 'node:util'
import { sql } from '@payloadcms/db-postgres'
import { APIError, ValidationError, type CollectionConfig, type Field, type PayloadRequest } from 'payload'
import { DEFAULT_MODEL_BY_TIER, deleteKey, ensureKey, gatewayEnabled, newKey, removeProvider, removeWorkspaceProviders, renderModels, verifyProvider, writeProvider } from './lib/gateway'
import { invalidFields, missingFields, parseIamSecret, PRESET_FIELDS, PRESETS, presetOf, type Preset } from './lib/providers'
import { oidcStrategy } from './lib/oidc-session'
import { decrypt, encrypt, isEncrypted } from './lib/secrets'
import { DEFAULT_WIP_LIMITS, wipLimitsError } from './lib/wip-limits'

export const isAdmin = ({ req }: { req: { user?: object | null } }): boolean => (req.user as { role?: string } | null)?.role === 'admin'

const AMBIENT_LOCK = 143

/** Serialises the ambient-identity single-tenant check against the write it guards; released when the request transaction ends. */
const lockAmbient = async (req: PayloadRequest): Promise<void> => {
  const db = req.payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> }; sessions: Record<string, { db: typeof db.drizzle }> }
  const tx = (req.transactionID ? db.sessions[await req.transactionID]?.db : undefined) ?? db.drizzle
  await tx.execute(sql`select pg_advisory_xact_lock(${AMBIENT_LOCK})`)
}

const TIERS = ['cheap', 'standard', 'strong'] as const
const llmConnections = async (req: PayloadRequest, workspace: number | string) =>
  (await req.payload.find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, req })).docs

/** USD only while every Connection ships a price catalog; an unpriced call would count 0 and never trip the budget. */
const unitOf = (conns: Record<string, any>[]) => (conns.every((c) => PRESETS[presetOf(c.config)].catalog) ? 'usd' : 'tokens')

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
  auth: { useAPIKey: true, strategies: [oidcStrategy] },
  admin: { useAsTitle: 'email' },
  access: {
    admin: isAdmin,
    create: isAdmin,
    delete: isAdmin,
    read: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
    update: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation === 'create' && !req.context.oidc && (await req.payload.count({ collection: 'bauherren' })).totalDocs === 0) {
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
    json('uiPrefs'),
    text('githubLogin', { admin: { description: 'Assigned to Tickets when this Bauherr claims a session Run (falls back to BAUHERR_BOT_LOGIN).' } }),
    text('oidcSubject', { index: true, access: { create: isAdmin, update: isAdmin }, admin: { description: 'issuer|sub of the OIDC identity (Keycloak: <issuer>|<user ID>). Set on first SSO sign-in; Admins can set it to link an existing Bauherr.' } }),
    { name: 'sessionVersion', type: 'number', defaultValue: 0, access: { create: () => false, update: () => false }, admin: { hidden: true } },
    { name: 'oidcSynced', type: 'date', access: { create: () => false, update: () => false }, admin: { readOnly: true, description: 'Last OIDC sign-in that synced role and Workspaces.' } },
  ],
}

const agentKeys = col(
  'agent_keys',
  [
    rel('owner', 'bauherren', { required: true, index: true }),
    text('label', { required: true }),
    text('keyHash', { required: true, unique: true, hidden: true }),
    text('prefix', { required: true, admin: { description: 'First characters of the key, to recognise it in lists.' } }),
    date('lastUsedAt'),
    date('revokedAt'),
  ],
  // Minted, used and revoked only through lib/api-key.ts (overrideAccess); never writable over the API.
  { access: { create: () => false, update: () => false, delete: () => false, read: ({ req }) => (req.user?.role === 'admin' ? true : { owner: { equals: req.user?.id } }) } },
)

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
    {
      name: 'wipLimits',
      type: 'json',
      defaultValue: DEFAULT_WIP_LIMITS,
      validate: (v: unknown) => wipLimitsError(v) ?? true,
      access: { update: ({ req }) => req.user?.role === 'admin' },
      admin: { description: 'Tickets per Board column, e.g. {"plan":3,"build":2,"review":3,"release":5}. A missing key means no limit.' },
    },
    { name: 'budgetUsd30d', type: 'number', defaultValue: 50, min: 0 },
    select('budgetUnit', ['usd', 'tokens'], { defaultValue: 'usd', admin: { description: 'Flips to tokens when the provider has no USD price catalog.' } }),
    { name: 'budgetTokens30d', type: 'number', defaultValue: 20000000, min: 0 },
    { name: 'modelByTier', type: 'json', defaultValue: DEFAULT_MODEL_BY_TIER },
    select('defaultMode', ['session', 'autonomous'], { admin: { description: 'Run mode for all stages; empty = BAUHERR_DEFAULT_MODE, then pack/workflow.yaml, then autonomous.' } }),
    { name: 'modeByStage', type: 'json', admin: { description: 'Per-stage override, e.g. {"plan":"session","build":"session"}.' } },
    rel('knowledgeConnection', 'connections', { admin: { description: 'GitHub Connection used to read the Knowledge repo.' } }),
    text('knowledgeRepo', { admin: { description: 'Knowledge repo as owner/name.' } }),
    { name: 'knowledgeIndexed', type: 'json', admin: { readOnly: true, description: 'What the Knowledge index was last built from (core pack hash, Knowledge repo commit, `product:<id>` = Product repo `<repo>@<commit>`, failure back-offs).' } },
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
      beforeValidate: [
        async ({ data, operation, originalDoc, req }) => {
          if (operation === 'update') {
            if (!data?.modelByTier) return
            const slugs = (await llmConnections(req, originalDoc.id)).map((c) => c.slug as string)
            const bad = Object.entries(data.modelByTier as Record<string, string>).filter(([, v]) => !slugs.some((s) => String(v).startsWith(`${s}/`) && String(v).length > s.length + 1))
            if (slugs.length && bad.length) {
              throw new ValidationError({ collection: 'workspaces', errors: bad.map(([path]) => ({ path, message: `must be <connection>/<model>, connection one of: ${slugs.join(', ')}` })) })
            }
            return
          }
          if (operation !== 'create') return
          await lockAmbient(req)
          const ambient = Object.keys(PRESETS).filter((k) => PRESETS[k as Preset].auth === 'ambient')
          const found = await req.payload.count({ collection: 'connections', where: { kind: { equals: 'llm-provider' }, provider: { in: ambient } }, overrideAccess: true, req })
          if (found.totalDocs) {
            throw new ValidationError({ collection: 'workspaces', errors: [{ path: 'name', message: 'a Connection uses the gateway ambient identity, shared by the whole gateway: no second Workspace allowed' }] })
          }
        },
      ],
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
          await removeWorkspaceProviders(doc.slug)
          await renderModels(req)
        },
      ],
    },
  },
)

const presetField = (name: (typeof PRESET_FIELDS)[number]): Field =>
  text(name, { admin: { condition: (data: Record<string, any>) => PRESETS[(data.provider as Preset) ?? 'anthropic'].required.includes(name) } })

const connections = col(
  'connections',
  [
    text('name', { required: true }),
    select('kind', ['github', 'gitlab', 'llm-provider'], { required: true }),
    json('config'),
    text('slug', { admin: { description: 'Names the Connection in model IDs (ws-<workspace>/<slug>/<model>) and tiers (<slug>/<model>). [a-z0-9-]; default: the provider; fixed after create.' } }),
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
      admin: {
        description:
          'Write-only. Encrypted at rest; leave empty to keep the stored value. What to paste: see the provider hint. Warning: bedrock-iam and foundry-entra secrets are written in plain text into the gateway config.yaml (0600).',
        condition: (data: Record<string, any>) => PRESETS[(data.provider as Preset) ?? 'anthropic'].auth !== 'ambient',
      },
      access: { read: () => false },
      hooks: {
        beforeChange: [({ value }) => (typeof value === 'string' && value && !isEncrypted(value) ? encrypt(value) : value)],
      },
    },
    json('capabilities'),
  ],
  {
    indexes: [{ fields: ['workspace', 'slug'], unique: true }],
    hooks: {
      beforeDelete: [
        async ({ id, req }) => {
          const doc = await req.payload.findByID({ collection: 'connections', id, depth: 0, overrideAccess: true, req })
          if (doc.kind !== 'llm-provider') return
          const wsId = typeof doc.workspace === 'object' ? doc.workspace.id : doc.workspace
          const ws = await req.payload.findByID({ collection: 'workspaces', id: wsId, depth: 0, overrideAccess: true, req })
          const used = TIERS.filter((t) => (ws.modelByTier as Record<string, string> | null)?.[t]?.startsWith(`${doc.slug}/`))
          if (used.length) throw new APIError(`Connection "${doc.slug}" is used by the tier(s) ${used.join(', ')}; point them at another Connection first`, 400)
        },
      ],
      beforeValidate: [
        async ({ data, originalDoc, req }) => {
          if ((data?.kind ?? originalDoc?.kind) !== 'llm-provider') return data
          const config = { ...originalDoc?.config, ...data?.config } as Record<string, string>
          // The top-level field wins only when this request changed it; otherwise an explicit `config` value stands (API, seed).
          for (const k of ['provider', ...PRESET_FIELDS]) {
            const prev = originalDoc?.[k] ?? (k === 'provider' ? 'anthropic' : undefined)
            if (data?.[k] != null && data[k] !== prev) config[k] = data[k]
          }
          const def = PRESETS[presetOf(config)]
          const prevAuth = originalDoc?.config ? PRESETS[presetOf(originalDoc.config)].auth : 'file'
          if (req.user && (req.user as { role?: string }).role !== 'admin' && (def.auth !== 'file' || prevAuth !== 'file')) {
            throw new ValidationError({ collection: 'connections', errors: [{ path: 'provider', message: 'inline-secret and ambient providers can be set by Admins only' }] })
          }
          const workspace = data?.workspace ?? originalDoc?.workspace
          const others = workspace ? (await llmConnections(req, typeof workspace === 'object' ? workspace.id : workspace)).filter((c) => c.id !== originalDoc?.id).map((c) => c.slug) : []
          let slug = data?.slug || originalDoc?.slug
          if (!slug) for (let n = 2, base = (slug = presetOf(config)); others.includes(slug); n++) slug = `${base}-${n}`
          if (originalDoc?.slug && slug !== originalDoc.slug) {
            throw new ValidationError({ collection: 'connections', errors: [{ path: 'slug', message: 'cannot change after create' }] })
          }
          if (!/^[a-z0-9-]+$/.test(slug) || others.includes(slug)) {
            throw new ValidationError({ collection: 'connections', errors: [{ path: 'slug', message: others.includes(slug) ? 'already used by another Connection of this Workspace' : 'only a-z, 0-9 and -' }] })
          }
          const bad = invalidFields(config)
          if (bad.length) throw new ValidationError({ collection: 'connections', errors: bad.map((path) => ({ path, message: 'malformed value' })) })
          if (presetOf(config) === 'bedrock-iam' && typeof data?.secret === 'string' && data.secret && !isEncrypted(data.secret) && !parseIamSecret(data.secret)) {
            throw new ValidationError({ collection: 'connections', errors: [{ path: 'secret', message: 'must be JSON {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."} (sessionToken optional)' }] })
          }
          const missing = missingFields(presetOf(config), config)
          if (missing.length) {
            throw new ValidationError({ collection: 'connections', errors: missing.map((path) => ({ path, message: `required for ${presetOf(config)}` })) })
          }
          if (def.auth === 'ambient') await lockAmbient(req)
          if (def.auth === 'ambient' && (await req.payload.count({ collection: 'workspaces', overrideAccess: true, req })).totalDocs !== 1) {
            throw new ValidationError({ collection: 'connections', errors: [{ path: 'provider', message: 'ambient identity is shared by the whole gateway: allowed only while the instance has exactly one Workspace' }] })
          }
          const mirrored = Object.fromEntries(['provider', ...PRESET_FIELDS].filter((k) => config[k] !== undefined).map((k) => [k, config[k]]))
          return { ...data, ...mirrored, config, slug }
        },
      ],
      afterChange: [
        async ({ doc, previousDoc, operation, req }) => {
          if (doc.kind !== 'llm-provider' || req.context.skipVerify) return
          const raw = (await req.payload.findByID({ collection: 'connections', id: doc.id, depth: 1, overrideAccess: true, req })) as unknown as {
            secret?: string
            workspace: { id: number | string; slug: string }
            capabilities?: Record<string, unknown> | null
          }
          const slug = doc.slug as string
          const preset = PRESETS[presetOf(doc.config)]
          const o = { overrideAccess: true, req } as const
          const ws = (await req.payload.findByID({ collection: 'workspaces', id: raw.workspace.id, depth: 0, ...o })) as unknown as {
            gatewayKey: string
            modelByTier: Record<string, string>
            budgetUnit: string
          }
          const conns = await llmConnections(req, raw.workspace.id)
          // Preset change (or new Connection) sets the budget unit and the tiers that point at this Connection or nowhere.
          const own = (v?: string) => !!v?.startsWith(`${slug}/`)
          const nowhere = (v?: string) => !conns.some((c) => v?.startsWith(`${c.slug}/`))
          const tiers = Object.fromEntries(
            TIERS.map((t) => {
              const v = ws.modelByTier?.[t]
              if (own(v)) return [t, operation === 'update' && preset.defaultModels ? `${slug}/${preset.defaultModels[t]}` : v]
              return [t, nowhere(v) ? `${slug}/${preset.defaultModels?.[t] ?? v ?? DEFAULT_MODEL_BY_TIER[t]}` : v]
            }),
          )
          const changed = operation === 'create' || presetOf(previousDoc?.config) !== presetOf(doc.config)
          const data: Record<string, unknown> = {}
          if (changed && ws.budgetUnit !== unitOf(conns)) data.budgetUnit = unitOf(conns)
          if (changed && !isDeepStrictEqual(ws.modelByTier, tiers)) data.modelByTier = tiers
          if (Object.keys(data).length) await req.payload.update({ collection: 'workspaces', id: raw.workspace.id, data, ...o })
          if (!gatewayEnabled()) return
          if (preset.auth === 'file' && raw.secret) await writeProvider(raw.workspace.slug, slug, decrypt(raw.secret), preset.secret.ext)
          await removeProvider(raw.workspace.slug, slug, ...(preset.auth === 'file' ? [preset.secret.ext === 'key' ? ('json' as const) : ('key' as const)] : (['key', 'json'] as const)))
          await renderModels(req)
          if (!process.env.GATEWAY_URL) return
          const current = (data.modelByTier ?? ws.modelByTier) as Record<string, string>
          const cheapest = TIERS.map((t) => current[t]).find(own) ?? `${slug}/${preset.defaultModels?.cheap ?? DEFAULT_MODEL_BY_TIER.cheap}`
          const result = await verifyProvider(raw.workspace.slug, decrypt(ws.gatewayKey), cheapest)
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
          if (doc.kind !== 'llm-provider') return
          const wsId = typeof doc.workspace === 'object' ? doc.workspace.id : doc.workspace
          const ws = await req.payload.findByID({ collection: 'workspaces', id: wsId, depth: 0, overrideAccess: true, req })
          const conns = await llmConnections(req, wsId)
          if (conns.length && ws.budgetUnit !== unitOf(conns)) await req.payload.update({ collection: 'workspaces', id: wsId, data: { budgetUnit: unitOf(conns) }, overrideAccess: true, req })
          if (!gatewayEnabled()) return
          await removeProvider(ws.slug, doc.slug)
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
  text('assignees'),
  date('sourceUpdatedAt'),
  { name: 'triageAttempts', type: 'number', defaultValue: 0, admin: { description: 'Triage Runs started for the current Ticket state; reset when the Ticket changes. The 3rd failure stops Triage.' } },
  date('triageAttemptAt'),
  { name: 'gatePendingAttempts', type: 'number', defaultValue: 0, admin: { description: 'Polls in which a gate label could not be verified; the poller re-reads the Ticket until it can, up to a bound.' } },
  { name: 'factoryStage', type: 'text', admin: { description: 'Stage the factory itself moved the forge label to; one-shot, read by the poller to tell it from a hand-set forward move.' } },
  { name: 'triagedAt', type: 'date', admin: { description: 'sourceUpdatedAt the last Triage covered; a Ticket is re-triaged only when it changes.' } },
  text('stage', { index: true }),
  select('waitingFor', ['plan', 'build', 'review'], { admin: { description: 'The full column this Ticket waits to enter. It stays ready in its column (and counts toward that column limit) and has no Run.' } }),
  text('rank', { index: true, admin: { description: 'Board order within the Workspace (base-62 fractional index); set by dragging on the Board.' } }),
  rel('parent', 'tickets'),
  rel('inheritedApprovalFrom', 'tickets', { admin: { description: 'Parent whose plan listed this Ticket at approval; the plan approval was inherited.' } }),
  rel('blockedBy', 'tickets', { hasMany: true }),
  text('mergeSha'),
  date('releaseAt'),
  date('deployRequestedAt'),
  select('releaseState', ['waiting', 'on_staging', 'timed_out']),
  select('productionState', ['awaiting_approval', 'deploying', 'deployed', 'failed', 'timed_out']),
  text('productionApprovedSha'),
  date('productionRequestedAt'),
  date('productionWebhookSentAt'),
  date('productionLabelAt'),
  text('releaseUrl'),
  date('releasePublishedAt'),
  date('releaseChecksSince'),
  date('releaseRetryAt'),
  { name: 'releaseAttempts', type: 'number', defaultValue: 0, admin: { description: 'Failed release publishes; the 3rd gives up.' } },
  text('releaseError'),
  text('releaseNotes'),
  text('releaseTag'),
  text('releaseSha'),
  select('releaseChecksState', ['waiting', 'passed', 'failed']),
  text('releaseRunUrl'),
  select('reviewState', ['waiting_checks', 'merged', 'ready_for_human', 'needs_human']),
  date('reviewWaitingSince'),
  { name: 'mergeFailures', type: 'number', defaultValue: 0, admin: { description: 'Consecutive failed merge attempts; the 3rd needs a human.' } },
  text('gateNotified'),
  date('gateNotifiedAt'),
  text('gateAssignees'),
  { name: 'gateUnreachable', type: 'text', admin: { description: 'The gate value whose owners are all rejected by the forge.' } },
  { name: 'conflictReturnBase', type: 'text', admin: { description: 'The head SHA a review covered before the MR went back to Build to merge the base; the next review covers only the diff from it. Cleared when that review concludes.' } },
  { name: 'conflictReturns', type: 'number', defaultValue: 0, admin: { description: 'Returns to Build because the MR conflicted; the 4th needs a human.' } },
  { name: 'reviewRounds', type: 'number', defaultValue: 0, admin: { description: 'Returns from review to build (changes verdicts and red checks); the 3rd needs a human.' } },
], { indexes: [{ fields: ['product', 'externalId'], unique: true }] })

export const runStatuses = ['queued', 'awaiting_session', 'running', 'succeeded', 'failed', 'cancelled', 'needs_human', 'budget_exhausted', 'abandoned']

export const collections: CollectionConfig[] = [
  bauherren,
  agentKeys,
  workspaces,
  col('products', [
    text('name', { required: true }),
    text('slug', { required: true }),
    text('stagingUrl'),
    select('deployMode', ['observe-ci', 'webhook'], { defaultValue: 'observe-ci', required: true }),
    text('deployWebhookUrl'),
    text('gateOwners', { admin: { description: 'Comma-separated GitHub logins assigned and mentioned at human gates; empty = Admin Bauherren with a githubLogin.' } }),
    text('deployChecks', { admin: { description: 'Comma-separated check names that must be green; empty = all.' } }),
    { name: 'autoMerge', type: 'checkbox', defaultValue: true, admin: { description: 'Squash-merge the factory MR after a clean review and green checks.' } },
    { name: 'productionGate', type: 'checkbox', defaultValue: false, admin: { description: 'Accepting on staging waits for an explicit production approval instead of moving to done; the Product\'s own pipeline deploys.' } },
    text('productionWebhookUrl', { admin: { description: 'Optional: POSTed once on production approval; a pipeline may instead react to the bauherr:approved:production label.' } }),
    select('releaseMode', ['notes-only', 'factory'], { defaultValue: 'notes-only', required: true, admin: { description: 'notes-only: the Product\'s own tooling makes the release, the factory adds the notes. factory: the factory tags, releases and opens a CHANGELOG.md MR.' } }),
    { name: 'releasePrerelease', type: 'checkbox', defaultValue: false, admin: { description: 'factory mode: publish a pre-release v<next>-rc.N instead of a stable version (no CHANGELOG MR).' } },
    text('releaseChecks', { admin: { description: 'Comma-separated check names on the release commit (for example image, npm); the Ticket shows "Released in" only when they pass. Empty: do not wait.' } }),
    { name: 'checkRetries', type: 'number', defaultValue: 1, min: 0, max: 1, admin: { description: 'Re-run a failed check once before it counts (1 = on, 0 = off).' } },
    text('productionChecks', { admin: { description: 'Comma-separated check names on the merge commit that report the production deploy; required for the production gate.' } }),
  ]),
  connections,
  col('repositories', [text('fullName', { required: true }), rel('product', 'products', { required: true })]),
  col('ticket_sources', [
    text('repo', { required: true }),
    rel('product', 'products', { required: true }),
    rel('connection', 'connections', { required: true }),
    text('cursor'),
    date('lastPolledAt'),
    text('lastError'),
  ]),
  tickets,
  col('runs', [
    rel('ticket', 'tickets', { required: true }),
    select('stage', ['triage', 'plan', 'build', 'review'], { required: true }),
    select('status', runStatuses, { required: true, defaultValue: 'queued' }),
    select('mode', ['session', 'autonomous'], { required: true, defaultValue: 'autonomous' }),
    rel('sessionOwner', 'bauherren'),
    rel('agentKey', 'agent_keys'),
    date('heartbeatAt'),
    text('leaseHash', { hidden: true }),
    rel('previousRun', 'runs'),
    text('evidence'),
    json('goal'),
    select('verdict', ['clean', 'changes']),
    json('findings'),
    text('reviewedSha'),
    text('reviewedPatchId'),
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
    rel('agentKey', 'agent_keys'),
    text('name'),
    text('inputDigest'),
    select('status', ['ok', 'error']),
    num('durationMs'),
  ]),
  col('human_touches', [
    text('kind'),
    rel('ticket', 'tickets'),
    rel('run', 'runs'),
    text('actor'),
    date('at'),
    text('repo'),
    text('path'),
    num('prNumber'),
    text('headSha'),
    text('baseContent'),
    text('status'),
  ], { access: { create: () => false, update: () => false, delete: () => false } }),
  col('check_flakes', [
    rel('ticket', 'tickets', { required: true }),
    text('checkName', { required: true }),
    num('checkId'),
    text('sha', { required: true }),
    text('runUrl'),
    select('outcome', ['pending', 'flake', 'failed'], { defaultValue: 'pending', required: true }),
  ], { indexes: [{ fields: ['ticket', 'sha', 'checkName'], unique: true }] }),
  col('knowledge_chunks', [
    text('source', { required: true, index: true }),
    select('layer', ['core', 'workspace', 'product'], { required: true }),
    text('path', { required: true }),
    text('logical', { required: true, index: true }),
    text('product'),
    text('heading'),
    text('text', { required: true }),
    text('commit', { required: true }),
  ]),
  col('intake_sessions', [
    rel('product', 'products', { required: true }),
    select('persona', ['product-user', 'owner'], { required: true, defaultValue: 'product-user' }),
    select('status', ['open', 'submitted', 'abandoned'], { required: true, defaultValue: 'open', index: true }),
    json('messages'),
    json('draft'),
    json('split'),
    json('turn'),
    { name: 'screenshots', type: 'number', defaultValue: 0 },
    { name: 'ticketNumber', type: 'number', admin: { description: 'Ticket created on submit.' } },
    json('ticketNumbers'),
    rel('user', 'bauherren'),
    rel('embedToken', 'embed_tokens'),
  ]),
  col('embed_tokens', [
    text('name', { required: true }),
    rel('product', 'products', { required: true }),
    { name: 'tokenHash', type: 'text', required: true, unique: true, access: { read: () => false }, admin: { hidden: true } },
    json('allowedOrigins'),
    { name: 'maxSessionsPerHour', type: 'number', defaultValue: 20, min: 1 },
    date('revokedAt'),
  ]),
  col('media', [
    rel('session', 'intake_sessions'),
    rel('product', 'products'),
    { name: 'ticketNumber', type: 'number', admin: { description: 'Ticket a comment image belongs to.' } },
    text('name', { required: true }),
    select('mime', ['image/png', 'image/jpeg', 'image/webp']),
    { name: 'data', type: 'textarea', admin: { description: 'Legacy base64 rows only; new files live in the upload store.' } },
    { name: 'attached', type: 'checkbox', defaultValue: false, admin: { description: 'Sent to the forge Ticket.' } },
  ], { upload: { staticDir: process.env.MEDIA_DIR ?? '/data/media', mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] } }),
  col('workflow_versions', [
    num('version'),
    rel('product', 'products', { required: true }),
    json('compiled'),
  ]),
]
