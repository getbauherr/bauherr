import { isDeepStrictEqual } from 'node:util'
import { sql } from '@payloadcms/db-postgres'
import { addDataAndFileToRequest, APIError, generatePayloadCookie, headersWithCors, ValidationError, type CollectionConfig, type Field, type PayloadRequest } from 'payload'
import { DEFAULT_MODEL_BY_TIER, deleteKey, ensureKey, ensureRouterKey, gatewayEnabled, newKey, removeProvider, revokeRouterKey, syncRouterKey, removeWorkspaceProviders, renderModels, verifyProvider, writeProvider } from './lib/gateway'
import { invalidFields, missingFields, parseIamSecret, PRESET_FIELDS, PRESETS, presetOf, type Preset } from './lib/providers'
import { ACCOUNT_LOCKED, accountLocked, carriesPayloadCredential, lockedRequests, oidcStrategy, SESSION_TTL_S } from './lib/oidc-session'
import { clientIp, LoginBusy, signInWithPassword } from './lib/login-lock'
import { decrypt, encrypt, isEncrypted } from './lib/secrets'
import { wipLimitsError } from './lib/wip-limits'
import { runKind, runStageError, waitingForError } from './lib/stage-text'
import { chatCollections } from './lib/chat/collections'
import { workflowFor } from './lib/factory'
import { TEMPLATE_NAMES } from './lib/template-text'

export const isAdmin = ({ req }: { req: { user?: object | null } }): boolean => (req.user as { role?: string } | null)?.role === 'admin'

type Doc = Record<string, any>
/** The workflow of the Workspace a document belongs to, or undefined when the document does not say. */
const wfOfDoc = (data?: Doc, sibling?: Doc) => {
  const w = sibling?.workspace ?? data?.workspace
  return w ? workflowFor(w) : undefined
}

const AMBIENT_LOCK = 143

/** Serialises the ambient-identity single-tenant check against the write it guards; released when the request transaction ends. */
const lockAmbient = async (req: PayloadRequest): Promise<void> => {
  const db = req.payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> }; sessions: Record<string, { db: typeof db.drizzle }> }
  const tx = (req.transactionID ? db.sessions[await req.transactionID]?.db : undefined) ?? db.drizzle
  await tx.execute(sql`select pg_advisory_xact_lock(${AMBIENT_LOCK})`)
}

const TIERS = ['cheap', 'standard', 'strong'] as const
const isRouter = (config: { provider?: string } | null | undefined) => presetOf(config) === 'router'
/** Ambient presets that share the gateway's own cloud identity; `router` is ambient (no user secret) but shares nothing. */
const sharedIdentity = (p: Preset) => PRESETS[p].auth === 'ambient' && p !== 'router'
const llmConnections = async (req: PayloadRequest, workspace: number | string) =>
  (await req.payload.find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, req })).docs

/** USD only while every Connection ships a price catalog; an unpriced call would count 0 and never trip the budget. The router prices nothing itself. */
const unitOf = (conns: Record<string, any>[]) => (conns.filter((c) => !isRouter(c.config)).every((c) => PRESETS[presetOf(c.config)].catalog) ? 'usd' : 'tokens')

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
  auth: { useAPIKey: true, strategies: [oidcStrategy], tokenExpiration: SESSION_TTL_S },
  admin: { useAsTitle: 'email' },
  // Replaces Payload's built-in login (custom endpoints are matched before the built-in ones) so REST and the Admin UI sign in through the same queue and IP limit as the login page.
  endpoints: [
    {
      path: '/login',
      method: 'post',
      handler: async (req) => {
        await addDataAndFileToRequest(req)
        const { email, password } = (req.data ?? {}) as { email?: unknown; password?: unknown }
        let result
        try {
          result = await signInWithPassword(req.payload, typeof email === 'string' ? email : '', typeof password === 'string' ? password : '', clientIp(req.headers))
        } catch (e) {
          if (e instanceof LoginBusy) return Response.json({ errors: [{ message: req.t('error:emailOrPasswordIncorrect') }] }, { status: 429 })
          throw e
        }
        const cookie = generatePayloadCookie({ collectionAuthConfig: req.payload.collections.bauherren.config.auth, cookiePrefix: req.payload.config.cookiePrefix, token: result.token })
        return Response.json({ message: req.t('authentication:passed'), ...result }, { headers: headersWithCors({ headers: new Headers({ 'Set-Cookie': cookie }), req }) })
      },
    },
  ],
  access: {
    admin: isAdmin,
    create: isAdmin,
    delete: isAdmin,
    read: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
    update: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
  },
  hooks: {
    // Payload's built-in API-key and local-JWT strategies ignore lockUntil: refuse their lookup while the request is still unauthenticated.
    // The throw hits any locked Bauherr read in an unauthenticated request that carries a credential; today only the strategies' own user lookups run there.
    afterRead: [
      async ({ doc, req }) => {
        if (!req.user && carriesPayloadCredential(req.headers) && (await accountLocked(req.payload, doc.id))) {
          lockedRequests.add(req.headers)
          throw new Error(ACCOUNT_LOCKED)
        }
        return doc
      },
    ],
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
      name: 'routerKey',
      type: 'text',
      admin: { description: 'Write-only. Consumer key of the vLLM Semantic Router for this Workspace; created with the first `router` Connection, encrypted at rest.' },
      access: { read: () => false, update: () => false },
      hooks: { beforeChange: [({ value }) => (typeof value === 'string' && value && !isEncrypted(value) ? encrypt(value) : value)] },
    },
    {
      name: 'wipLimits',
      type: 'json',
      validate: (v: unknown, { id }: { id?: number | string }) => wipLimitsError(v, id ? workflowFor(id) : undefined) ?? true,
      access: { update: ({ req }) => req.user?.role === 'admin' },
      admin: { description: 'Override of the factory file: tickets per Board column, e.g. {"plan":3,"build":2,"review":3,"release":5}. A missing key means no limit; empty = the `wip` of each stage in the factory file (applying a file clears it).' },
    },
    rel('workflowVersion', 'workflow_versions', { admin: { description: 'The active factory file version; empty = the pack default. Set by applyFactory.' } }),
    { name: 'expediteLane', type: 'checkbox', defaultValue: true, admin: { description: 'Settings > Factory > Workflow: off ignores the bauherr:expedite label.' } },
    { name: 'progressComments', type: 'checkbox', defaultValue: true, admin: { description: 'Settings > General: keep one plain-word progress Comment on each issue and mention its author at the moments that matter.' } },
    { name: 'budgetUsd30d', type: 'number', defaultValue: 50, min: 0 },
    select('budgetUnit', ['usd', 'tokens'], { defaultValue: 'usd', admin: { description: 'Flips to tokens when the provider has no USD price catalog.' } }),
    { name: 'budgetTokens30d', type: 'number', defaultValue: 20000000, min: 0 },
    { name: 'routerBudgetShare', type: 'number', defaultValue: 20, min: 1, max: 99, admin: { description: 'Percent of the budget for `auto` traffic while a router Connection exists.' } },
    { name: 'modelByTier', type: 'json', defaultValue: DEFAULT_MODEL_BY_TIER },
    select('defaultMode', ['session', 'autonomous'], { admin: { description: 'Run mode for all stages; empty = BAUHERR_DEFAULT_MODE, then pack/factory.yaml, then autonomous.' } }),
    { name: 'modeByStage', type: 'json', admin: { description: 'Per-stage override, e.g. {"plan":"session","build":"session"}.' } },
    rel('knowledgeConnection', 'connections', { admin: { description: 'GitHub Connection used to read the Knowledge repo.' } }),
    text('knowledgeRepo', { admin: { description: 'Knowledge repo as owner/name.' } }),
    { name: 'knowledgeIndexed', type: 'json', admin: { readOnly: true, description: 'What the Knowledge index was last built from (core pack hash, Knowledge repo commit, `product:<id>` = Product repo `<repo>@<commit>`, failure back-offs).' } },
  ],
  {
    access: {
      create: isAdmin,
      update: isAdmin, // budget, model tiers, run modes and the rest of a Workspace are Admin settings, over /api as in the UI
      delete: isAdmin,
      read: ({ req }) =>
        req.user?.role === 'admin'
          ? true
          : { id: { in: ((req.user?.tenants as { tenant: { id: number } | number }[]) ?? []).map((t) => (typeof t.tenant === 'object' ? t.tenant.id : t.tenant)) } },
    },
    hooks: {
      beforeValidate: [
        async ({ data, operation, originalDoc, req }) => {
          const tiers = Object.entries((data?.modelByTier ?? {}) as Record<string, string>)
          const slash = tiers.some(([, v]) => String(v).endsWith('/auto'))
          const routerSlug = slash && originalDoc?.id ? (await llmConnections(req, originalDoc.id)).find((c) => isRouter(c.config))?.slug : undefined
          const auto = tiers.filter(([, v]) => v === 'auto' || (routerSlug && v === `${routerSlug}/auto`))
          if (auto.length) throw new ValidationError({ collection: 'workspaces', errors: auto.map(([path]) => ({ path, message: '`auto` is the router tier, not a model; pick <connection>/<model>' })) })
          if (operation === 'update') {
            if (!data?.modelByTier) return
            const slugs = (await llmConnections(req, originalDoc.id)).filter((c) => !isRouter(c.config)).map((c) => c.slug as string)
            const bad = Object.entries(data.modelByTier as Record<string, string>).filter(([, v]) => !slugs.some((s) => String(v).startsWith(`${s}/`) && String(v).length > s.length + 1))
            if (slugs.length && bad.length) {
              throw new ValidationError({ collection: 'workspaces', errors: bad.map(([path]) => ({ path, message: `must be <connection>/<model>, connection one of: ${slugs.join(', ')}` })) })
            }
            return
          }
          if (operation !== 'create') return
          await lockAmbient(req)
          const ambient = Object.keys(PRESETS).filter((k) => sharedIdentity(k as Preset))
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
            (['budgetUsd30d', 'budgetUnit', 'budgetTokens30d', 'routerBudgetShare'] as const).some((k) => doc[k] !== previousDoc?.[k])
          )
            await ensureKey(req, doc.id)
          else if (!isDeepStrictEqual(doc.modelByTier, previousDoc?.modelByTier)) await syncRouterKey(req, doc.id)
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
          if (isRouter(config)) {
            await lockAmbient(req)
            const wsId = typeof workspace === 'object' ? workspace.id : workspace
            if ((await req.payload.count({ collection: 'connections', where: { kind: { equals: 'llm-provider' }, provider: { equals: 'router' }, workspace: { not_equals: wsId } }, overrideAccess: true, req })).totalDocs) {
              throw new ValidationError({ collection: 'connections', errors: [{ path: 'provider', message: 'the router serves one Workspace: another Workspace already has a router Connection' }] })
            }
          }
          if (sharedIdentity(presetOf(config))) await lockAmbient(req)
          if (sharedIdentity(presetOf(config)) && (await req.payload.count({ collection: 'workspaces', overrideAccess: true, req })).totalDocs !== 1) {
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
          const router = isRouter(doc.config)
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
          if (!router && changed && ws.budgetUnit !== unitOf(conns)) data.budgetUnit = unitOf(conns)
          if (!router && changed && !isDeepStrictEqual(ws.modelByTier, tiers)) data.modelByTier = tiers
          if (Object.keys(data).length) await req.payload.update({ collection: 'workspaces', id: raw.workspace.id, data, ...o })
          if (!gatewayEnabled()) return
          if (preset.auth === 'file' && raw.secret) await writeProvider(raw.workspace.slug, slug, decrypt(raw.secret), preset.secret.ext)
          await removeProvider(raw.workspace.slug, slug, ...(preset.auth === 'file' ? [preset.secret.ext === 'key' ? ('json' as const) : ('key' as const)] : (['key', 'json'] as const)))
          if (router) {
            await ensureRouterKey(req, raw.workspace.id)
            await ensureKey(req, raw.workspace.id)
          }
          else if (isRouter(previousDoc?.config) && !conns.some((c) => isRouter(c.config))) await revokeRouterKey(req, raw.workspace.id, raw.workspace.slug)
          await renderModels(req)
          if (!process.env.GATEWAY_URL) return
          const current = (data.modelByTier ?? ws.modelByTier) as Record<string, string>
          const cheapest = router ? current.cheap : TIERS.map((t) => current[t]).find(own) ?? `${slug}/${preset.defaultModels?.cheap ?? DEFAULT_MODEL_BY_TIER.cheap}`
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
          if (isRouter(doc.config) && !conns.some((c) => isRouter(c.config))) await revokeRouterKey(req, wsId, ws.slug)
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
  text('needsYou', { index: true, admin: { readOnly: true, description: 'What the Ticket needs from the owner (needsOf), written by the gate sweep; the top bar counts it. Null = nothing.' } }),
  text('waitingFor', { validate: (v: unknown, { data, siblingData }: { data?: Doc; siblingData?: Doc }) => waitingForError(wfOfDoc(data, siblingData), v), admin: { description: 'The full column this Ticket waits to enter from an earlier column (never its own stage), or checks (asked for review while the MR head checks run). It stays in its column and has no Run.' } }),
  date('expediteAt'),
  text('gateNoticeClaim'),
  { name: 'expedite', type: 'checkbox', defaultValue: false, admin: { description: 'Carries the bauherr:expedite label while the Workspace has the Expedite lane on: skips Triage, bypasses WIP and the overlap hold, no plan gate.' } },
  text('waitingReason', { admin: { description: 'Why it waits when not a full column, e.g. "overlaps #12" (a Build held for shared paths).' } }),
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
  text('releasedIn', { index: true, admin: { description: 'Tag of the shipped release (e.g. v0.2.0) the Ticket is part of; empty = waiting for a release.' } }),
  date('releasedAt'),
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
  select('reviewState', ['waiting_checks', 'queued', 'merged', 'ready_for_human', 'needs_human']),
  date('reviewWaitingSince'),
  { name: 'queuedAt', type: 'date', admin: { readOnly: true, description: 'When the MR entered the forge merge queue (`reviewState` queued).' } },
  { name: 'trainFailures', type: 'number', defaultValue: 0, admin: { description: 'Times the merge queue or train dropped the MR (its checks failed there); the 3rd needs a human.' } },
  { name: 'mergeFailures', type: 'number', defaultValue: 0, admin: { description: 'Consecutive failed merge attempts; the 3rd needs a human.' } },
  text('gateNotified'),
  date('gateNotifiedAt'),
  text('gateAssignees'),
  { name: 'gateUnreachable', type: 'text', admin: { description: 'The gate value whose owners are all rejected by the forge.' } },
  { name: 'conflictReturnBase', type: 'text', admin: { description: 'The head SHA a review covered before the MR went back to Build to merge the base; the next review covers only the diff from it. Cleared when that review concludes.' } },
  { name: 'conflictReturns', type: 'number', defaultValue: 0, admin: { description: 'Returns to Build because the MR conflicted; the 4th needs a human.' } },
  { name: 'mainMergeSha', type: 'text', admin: { readOnly: true, description: 'The MR head on which the factory last found nothing to merge; with `mainMergeNoops` it detects a forge that keeps reporting that head behind or conflicting.' } },
  { name: 'mainMergeNoops', type: 'number', defaultValue: 0, admin: { readOnly: true, description: 'No-op merges of the base on `mainMergeSha`; the 3rd needs a human. Reset by a merge that pushes.' } },
  { name: 'reviewRounds', type: 'number', defaultValue: 0, admin: { description: 'Returns from review to build (changes verdicts and red checks); the 3rd needs a human.' } },
  { name: 'openCriticalDecisions', type: 'number', admin: { readOnly: true, description: 'Unanswered critical decisions of the plan or triage sheet, as last read from the forge comments (plan submit, answers, the gate sweep). Pages read this instead of the forge; null = never read.' } },
  { name: 'liveness', type: 'json', admin: { readOnly: true, description: 'Last `watch-liveness` finding for a Ticket with no live Run: {cause, need, at}. null = not dead at the last sweep.' } },
  { name: 'decision', type: 'json', admin: { readOnly: true, description: 'The open human checkpoint, prepared for the Inbox and the Ticket page (`buildDecision`): {need, checkpoint, title, ask, recommendation, why, options, next, evidence, details, preparedBy, preparedAt, openSince}. Written by the gate sweep together with `needsYou`; null = nothing is waiting.' } },
  { name: 'planTldr', type: 'json', admin: { readOnly: true, description: 'Parsed `## TL;DR` of the latest plan: {decision, recommendation, why, risk, options}. Stored when the plan is posted, so no page or sweep reads the forge for it.' } },
  { name: 'stagingTldr', type: 'json', admin: { readOnly: true, description: 'First two sections of the posted staging summary: {whatYouGet, found}.' } },
  { name: 'decidedAt', type: 'date', admin: { readOnly: true, description: 'When the owner last decided a checkpoint in the UI; the sweep does not reopen `decidedNeed` for 2 minutes.' } },
  { name: 'decidedNeed', type: 'text', admin: { readOnly: true } },
  text('progressHash', { admin: { readOnly: true, description: 'Hash of the body of the progress Comment last written to the issue; unchanged = no forge call. Claimed before the write, released when it fails.' } }),
  text('progressCommentId', { admin: { readOnly: true, description: 'The forge id of the progress Comment, so an update is one call.' } }),
  text('progressNotified', { admin: { readOnly: true, description: 'The progress key (question, staging, released, stuck) whose notice Comment was posted for the current stretch in that state; cleared when the Ticket leaves it.' } }),
  text('historyKey', { admin: { readOnly: true, description: 'The `stage|phase` of the newest ticket_events row; `record` writes an event only when it changes.' } }),
], {
  indexes: [{ fields: ['product', 'externalId'], unique: true }, { fields: ['workspace', 'state'] }],
  hooks: {
    /** The one write guard for "waitingFor is never the Ticket's own stage" (except an overlap hold, which carries a `waitingReason`): covers the poller, `completeMove` and hand edits. */
    beforeChange: [
      ({ data, originalDoc }) => {
        const stage = 'stage' in data ? data.stage : originalDoc?.stage
        const waitingFor = 'waitingFor' in data ? data.waitingFor : originalDoc?.waitingFor
        const reason = 'waitingReason' in data ? data.waitingReason : originalDoc?.waitingReason
        // A Build held for overlapping paths (`waitingReason` "overlaps #N") may sit in Build without a Run: the reason marks it as deliberate.
        if (waitingFor && waitingFor === stage && !reason) data.waitingFor = null
        return data
      },
    ],
  },
})

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
    { name: 'expediteSkipStaging', type: 'checkbox', defaultValue: false, admin: { description: 'An expedite (Hotfix) Ticket skips the Accept on staging gate once its merge is on staging; the production gate still waits for a human.' } },
    text('expediteSkipStagingBy'),
    date('expediteSkipStagingAt'),
    { name: 'autoMerge', type: 'checkbox', defaultValue: true, admin: { description: 'Squash-merge the factory MR after a clean review and green checks.' } },
    select('mergeMode', ['direct', 'queue', 'train'], { defaultValue: 'direct', required: true, admin: { description: 'direct: the factory squash-merges the MR itself. queue: it enqueues the reviewed head in the forge\'s merge queue. train: the factory tests queued MRs together on its own bauherr/train branch and merges them in order.' } }),
    { name: 'trainState', type: 'json', admin: { readOnly: true, description: 'The running factory train: { baseSha, members: [{ ticket, pr, headSha }], phase, probe, results, tip, since }; null unless one is running.' } },
    { name: 'mergePreflight', type: 'json', admin: { readOnly: true, description: 'Result of the last repo preflight for queue or train mode: {ok, problems, at}.' } },
    { name: 'productionGate', type: 'checkbox', defaultValue: false, admin: { description: 'Accepting on staging waits for an explicit production approval instead of moving to done; the Product\'s own pipeline deploys.' } },
    text('productionWebhookUrl', { admin: { description: 'Optional: POSTed once on production approval; a pipeline may instead react to the bauherr:approved:production label.' } }),
    select('releaseMode', ['notes-only', 'factory', 'manual'], { defaultValue: 'notes-only', required: true, admin: { description: 'notes-only: the Product\'s own tooling makes the release, the factory adds the notes. factory: the factory tags, releases and opens a CHANGELOG.md MR. manual: no automatic release; a person ships it from the forge release flow.' } }),
    text('lastReleaseTag', { admin: { description: 'Newest release shipped from the Releases page (or found there once); the Board reads it instead of asking the forge.' } }),
    text('lastReleaseSha'),
    date('lastReleaseAt'),
    { name: 'releaseReminderDays', type: 'number', defaultValue: 7, min: 1, admin: { description: 'manual mode: remind the owner when done Tickets wait longer than this many days for a release.' } },
    { name: 'releasePrerelease', type: 'checkbox', defaultValue: false, admin: { description: 'factory mode: publish a pre-release v<next>-rc.N instead of a stable version (no CHANGELOG MR).' } },
    text('releaseChecks', { admin: { description: 'Comma-separated check names on the release commit (for example image, npm); the Ticket shows "Released in" only when they pass. Empty: do not wait.' } }),
    { name: 'checkRetries', type: 'number', defaultValue: 1, min: 0, max: 1, admin: { description: 'Re-run a failed check once before it counts (1 = on, 0 = off).' } },
    text('productionChecks', { admin: { description: 'Comma-separated check names on the merge commit that report the production deploy; required for the production gate.' } }),
    {
      name: 'securityScan',
      type: 'group',
      admin: { description: 'Read-only security scan Runs (stage scan). Start one by hand from the Product page or let the hourly tick start one when the cron is due.' },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false, admin: { description: 'Scan this Product on the schedule.' } },
        text('cron', { defaultValue: '0 0 4 * * 1', admin: { description: 'When the scheduled scan runs, 6-field cron (seconds first). Default: Mondays 04:00.' } }),
        { name: 'maxBudgetUsd', type: 'number', min: 0, admin: { description: 'Budget of one scan Run in USD. Empty: 2. Never above 10.' } },
        { name: 'maxTurns', type: 'number', min: 1, admin: { description: 'Turns of one scan Run. Empty: 30.' } },
        date('lastScanAt'),
      ],
    },
    { name: 'reviewChecks', type: 'json', admin: { description: 'Path-based checks a Build must pass before it requests review: {tests: [{src: [globs], tests: [globs]}], schema: [{schema: [globs], migration: [globs]}], evidence: true}. Empty: all off.' } },
    {
      name: 'overlapIgnore',
      type: 'json',
      defaultValue: [],
      validate: (v: unknown) => v == null || (Array.isArray(v) && v.every((g) => typeof g === 'string' && g.trim() !== '' && !/\s/.test(g))) || 'must be a list of path globs without spaces',
      access: { update: ({ req }) => req.user?.role === 'admin' },
      admin: { description: 'Path globs that never hold a Build for overlapping files, e.g. ["CHANGELOG.md","pnpm-lock.yaml"].' },
    },
    { name: 'overlapSuggestions', type: 'json', admin: { readOnly: true, description: 'Result of the last "Suggest paths" action: {at, items: [{path, percent}]}. Computed on request, never on page render.' } },
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
    text('stage', { required: true, index: true, validate: (v: unknown, { data, siblingData }: { data?: Doc; siblingData?: Doc }) => runStageError(wfOfDoc(data, siblingData), v) }),
    text('kind', { index: true, admin: { description: 'The stage kind the Run ran for (or scan / distill); filled from `stage` on create.' } }),
    select('status', runStatuses, { required: true, defaultValue: 'queued', index: true }),
    select('mode', ['session', 'autonomous'], { required: true, defaultValue: 'autonomous' }),
    rel('sessionOwner', 'bauherren'),
    rel('agentKey', 'agent_keys'),
    text('sessionLabel'),
    date('heartbeatAt'),
    text('lastLeaseCall'),
    text('lastSeenSha'),
    text('leaseHash', { hidden: true }),
    rel('previousRun', 'runs'),
    { name: 'investigation', type: 'json', admin: { description: 'Set only on an investigation Plan Run: { failedRuns: number[], stage }. The Run runs on the strong tier.' } },
    { name: 'escalation', type: 'json', admin: { description: 'Set only on an escalated Run: { step: 2 | 3, reason, previousRuns: number[] }. Written with the create; the Run runs on the strong tier with doubled caps.' } },
    select('reasonKind', ['decision', 'access', 'stuck'], { admin: { description: 'Why a Run stopped: decision (product question) and access (credential, setting) reach the owner, stuck escalates. On failed Runs it is set when the escalation ladder ended at the owner.' } }),
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
    select('costSource', ['sdk-estimate', 'gateway', 'session-reported'], { defaultValue: 'sdk-estimate' }),
    select('reconcileStatus', ['pending', 'matched', 'mismatch', 'unavailable', 'unpriced'], { defaultValue: 'pending' }),
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
    text('executor', { admin: { description: 'Who ran it: session (an agent session) or runner (the autonomous Runner).' } }),
    text('role'),
    text('clientName', { admin: { description: 'The session client (claude-code, ...), from the claim or the MCP User-Agent.' } }),
    text('clientVersion'),
    text('provider', { admin: { description: 'The provider preset behind the model.' } }),
    text('outcome'),
    rel('session', 'agent_sessions', { admin: { description: 'The connected agent session that works the Run (`next_work`); empty for a legacy claim and for autonomous Runs.' } }),
  ], {
    indexes: [{ fields: ['mode', 'status', 'heartbeatAt'] }],
    hooks: {
      beforeValidate: [
        ({ data, operation }) => {
          if (operation === 'create' && data && !data.kind && typeof data.stage === 'string') data.kind = runKind(wfOfDoc(data, data) ?? workflowFor(null), data.stage)
          return data
        },
      ],
    },
  }),
  col('steps', [
    rel('run', 'runs', { required: true }),
    num('seq'),
    text('messageId'),
    num('tokensIn'),
    num('tokensOut'),
    num('costEstimateUsd'),
    date('startedAt'),
    text('summary'),
    date('finishedAt'),
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
  ], { access: { create: () => false, update: () => false, delete: () => false }, indexes: [{ fields: ['kind', 'at'] }] }),
  col('skill_proposals', [
    rel('ticket', 'tickets', { required: true, unique: true }),
    rel('run', 'runs'),
    select('status', ['proposed', 'replayed', 'accepted', 'rejected', 'skipped'], { required: true, defaultValue: 'proposed' }),
    num('pr'),
    text('skillPath'),
    num('score'),
    num('baselineScore'),
    json('results'),
    text('reason'),
  ]),
  col('templates', [
    select('name', [...TEMPLATE_NAMES], { required: true }),
    { name: 'body', type: 'textarea', required: true, admin: { description: 'The Workspace\'s version of the pack template `pack/templates/<name>.md`, without front matter. Absent = the pack default.' } },
    text('updatedBy'),
  ], { indexes: [{ fields: ['workspace', 'name'], unique: true }] }),
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
    select('mime', ['image/png', 'image/jpeg', 'image/webp', 'video/webm', 'video/mp4']),
    { name: 'data', type: 'textarea', admin: { description: 'Legacy base64 rows only; new files live in the upload store.' } },
    { name: 'attached', type: 'checkbox', defaultValue: false, admin: { description: 'Sent to the forge Ticket.' } },
  ], { upload: { staticDir: process.env.MEDIA_DIR ?? '/data/media', mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'video/webm', 'video/mp4'] } }),
  col('artifacts', [
    rel('ticket', 'tickets', { required: true, index: true }),
    rel('run', 'runs'),
    select('kind', ['image', 'recording', 'preview', 'transcript', 'sample', 'report'], { required: true }),
    text('title', { required: true }),
    text('criterion', { admin: { description: 'The acceptance criterion this proves.' } }),
    text('rule', { admin: { description: 'The Product rule it satisfies.' } }),
    rel('media', 'media'),
    text('url'),
    { name: 'text', type: 'textarea', admin: { description: 'Transcript, sample or report; rendered as text.' } },
    select('pair', ['before', 'after']),
    text('sha', { required: true, admin: { description: 'The commit it was made on.' } }),
    { name: 'waived', type: 'checkbox', defaultValue: false, admin: { description: 'No proof for the rule; `text` is the reason (Evidence line "No artifact: <rule>: <reason>").' } },
  ], { access: { create: () => false, update: () => false, delete: () => false, read: ({ req }: { req: { user?: object | null } }) => !!req.user } }),
  col('workflow_versions', [
    num('version'),
    rel('product', 'products', { admin: { description: 'Reserved.' } }),
    { name: 'source', type: 'textarea', admin: { description: 'The factory file with role profiles inlined.' } },
    json('compiled'),
    text('hash', { index: true, admin: { description: 'sha256 of the canonical compiled workflow.' } }),
    text('appliedBy'),
    text('appliedVia', { admin: { description: 'ui | api | cli | boot | seed' } }),
    text('note'),
  ]),
  col('ticket_events', [
    // Not `required`: a NOT NULL column with ON DELETE SET NULL would make deleting a Ticket fail; `record` always sets it.
    rel('ticket', 'tickets'),
    { name: 'at', type: 'date', required: true },
    text('stage', { admin: { description: 'The stage the Ticket is in from this moment.' } }),
    text('stageKind'),
    select('phase', ['working', 'queued', 'human', 'ci', 'closed'], { required: true }),
    text('fromStage'),
    text('outcome'),
    rel('run', 'runs'),
    select('executor', ['session', 'runner', 'ci', 'human', 'factory']),
    text('actor'),
    text('cause', { admin: { description: 'Short machine reason, e.g. moveStage:request_review, run:claimed, gate:approve:plan, sweep.' } }),
    num('workflowVersion'),
    { name: 'backfilled', type: 'checkbox', defaultValue: false },
  ], { access: { create: () => false, update: () => false, delete: () => false }, indexes: [{ fields: ['ticket', 'at'] }, { fields: ['workspace', 'at'] }] }),
  col('agent_sessions', [
    { name: 'publicId', type: 'text', required: true, unique: true },
    rel('owner', 'bauherren'),
    rel('agentKey', 'agent_keys'),
    text('role', { required: true, admin: { description: 'A role id of the Workspace workflow.' } }),
    text('label'),
    text('clientKey', { admin: { description: 'Stable id the client supplies; the same key reconnects the same row.' } }),
    text('clientName'),
    text('clientVersion'),
    text('provider'),
    text('model'),
    date('connectedAt'),
    date('lastSeenAt'),
    date('disconnectedAt'),
    select('endReason', ['disconnect', 'timeout', 'replaced']),
  ], { indexes: [{ fields: ['workspace', 'disconnectedAt'] }, { fields: ['lastSeenAt'] }, { fields: ['workspace', 'owner', 'clientKey'], unique: true }] }),
  col('session_spans', [
    rel('session', 'agent_sessions'),
    rel('run', 'runs'),
    rel('ticket', 'tickets'),
    date('startedAt'),
    date('lastAt'),
  ], { indexes: [{ fields: ['session', 'startedAt'] }] }),
  col('usage_entries', [
    rel('run', 'runs'),
    rel('session', 'agent_sessions'),
    rel('ticket', 'tickets'),
    text('stage'),
    text('role'),
    text('model', { required: true, defaultValue: 'unknown' }),
    text('provider'),
    num('tokensIn'),
    num('tokensOut'),
    num('cacheRead'),
    num('cacheWrite'),
    num('costUsd'),
    select('source', ['gateway', 'session-reported', 'chat'], { required: true }),
    { name: 'at', type: 'date', required: true },
  ], { access: { create: () => false, update: () => false, delete: () => false }, indexes: [{ fields: ['run', 'source', 'model'], unique: true }, { fields: ['workspace', 'source', 'at'] }] }),
  col('usage_cursors', [
    rel('session', 'agent_sessions', { required: true }),
    text('claudeSession', { required: true, admin: { description: "The client's own session id (Claude Code `session_id`)." } }),
    json('totals'),
  ], { access: { create: () => false, update: () => false, delete: () => false }, indexes: [{ fields: ['session', 'claudeSession'], unique: true }] }),
  col('instance_state', [text('key', { required: true, unique: true }), json('value')], { access: { read: () => false, create: () => false, update: () => false, delete: () => false } }),
  ...chatCollections,
]
