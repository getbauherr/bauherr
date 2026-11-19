import { isDeepStrictEqual } from 'node:util'
import { sql } from '@payloadcms/db-postgres'
import { addDataAndFileToRequest, APIError, generatePayloadCookie, headersWithCors, ValidationError, type CollectionConfig, type Field, type PayloadRequest } from 'payload'
import { DEFAULT_MODEL_BY_TIER, deleteKey, ensureKey, gatewayEnabled, newKey, removeProvider, removeWorkspaceProviders, renderModels, verifyProvider, writeProvider } from './lib/gateway'
import { invalidFields, missingFields, parseIamSecret, PRESET_FIELDS, PRESETS, presetOf, type Preset } from './lib/providers'
import { ACCOUNT_LOCKED, accountLocked, carriesPayloadCredential, lockedRequests, oidcStrategy, SESSION_TTL_S } from './lib/oidc-session'
import { clientIp, LoginBusy, signInWithPassword } from './lib/login-lock'
import { decrypt, encrypt, isEncrypted } from './lib/secrets'
import { assignmentRows, isBauherr, ROLES, tenantIds } from './lib/people'
import { coreCollections } from './core/collections'

export const isAdmin = ({ req }: { req: { user?: object | null } }): boolean => (req.user as { role?: string } | null)?.role === 'admin'
export const bauherrOnly = ({ req }: { req: { user?: object | null } }): boolean => isBauherr(req.user as Doc | null)

type Doc = Record<string, any>
const AMBIENT_LOCK = 143
const ACCOUNT_LOCK = 144

const lockAmbient = async (req: PayloadRequest, key = AMBIENT_LOCK): Promise<void> => {
  const db = req.payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> }; sessions: Record<string, { db: typeof db.drizzle }> }
  const tx = (req.transactionID ? db.sessions[await req.transactionID]?.db : undefined) ?? db.drizzle
  await tx.execute(sql`select pg_advisory_xact_lock(${key})`)
}

const lockAccount = async (req: PayloadRequest, id: number | string): Promise<void> => {
  const db = req.payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> }; sessions: Record<string, { db: typeof db.drizzle }> }
  const tx = (req.transactionID ? db.sessions[await req.transactionID]?.db : undefined) ?? db.drizzle
  await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_LOCK}, ${Number(id)})`)
}

const TIERS = ['cheap', 'standard', 'strong'] as const
const sharedIdentity = (p: Preset) => PRESETS[p].auth === 'ambient'
const llmConnections = async (req: PayloadRequest, workspace: number | string) =>
  (await req.payload.find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, req })).docs

const unitOf = (conns: Record<string, any>[]) => (conns.every((c) => PRESETS[presetOf(c.config)].catalog) ? 'usd' : 'tokens')

const rel = (name: string, to: string, extra: Partial<Field> = {}): Field =>
  ({ name, type: 'relationship', relationTo: to, ...extra }) as Field
const text = (name: string, extra: Partial<Field> = {}): Field => ({ name, type: 'text', ...extra }) as Field
const date = (name: string): Field => ({ name, type: 'date' })
const json = (name: string): Field => ({ name, type: 'json' })
const select = (name: string, options: string[], extra: Partial<Field> = {}): Field =>
  ({ name, type: 'select', options, ...extra }) as Field

const col = (slug: string, fields: Field[], extra: Partial<CollectionConfig> = {}): CollectionConfig => ({
  slug,
  admin: { useAsTitle: (fields[0] as { name: string }).name },
  fields,
  ...extra,
  access: { read: bauherrOnly, create: bauherrOnly, update: bauherrOnly, delete: bauherrOnly, ...extra.access },
})

const SELF_FIELDS = ['uiPrefs', 'password', 'githubLogin']

const bauherren: CollectionConfig = {
  slug: 'bauherren',
  labels: { singular: 'Bauherr', plural: 'Bauherren' },
  auth: { useAPIKey: true, strategies: [oidcStrategy], tokenExpiration: SESSION_TTL_S },
  admin: { useAsTitle: 'email' },
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
    beforeValidate: [
      async ({ data, originalDoc, operation, req }) => {
        if (!data) return data
        const fail = (path: string, message: string) => new ValidationError({ collection: 'bauherren', errors: [{ path, message }] })
        if (operation === 'update' && originalDoc?.id != null) {
          await lockAccount(req, originalDoc.id)
          const fresh = (await req.payload.findByID({ collection: 'bauherren', id: originalDoc.id, depth: 0, overrideAccess: true, select: { updatedAt: true }, req })) as { updatedAt?: string }
          if (fresh.updatedAt !== originalDoc.updatedAt) throw fail('id', 'This account changed while you were editing it. Reload and try again.')
        }
        if (operation === 'update' && req.user?.role === 'product-owner') {
          const other = Object.keys(data).filter((k) => ![...SELF_FIELDS, 'updatedAt', 'createdAt'].includes(k) && !isDeepStrictEqual(data[k] ?? null, originalDoc?.[k] ?? null))
          if (other.length) throw fail(other[0], 'A Product owner can change only the password, display preferences and forge login')
        }
        if (data.githubLogin && data.githubLogin !== originalDoc?.githubLogin) {
          const mine = String(data.githubLogin).split(',').map((l) => l.trim().toLowerCase()).filter(Boolean)
          const others = await req.payload.find({ collection: 'bauherren', where: { and: [{ githubLogin: { exists: true } }, ...(originalDoc?.id != null ? [{ id: { not_equals: originalDoc.id } }] : [])] }, pagination: false, depth: 0, overrideAccess: true, select: { githubLogin: true }, req })
          if (others.docs.some((u) => String(u.githubLogin).split(',').some((l) => mine.includes(l.trim().toLowerCase())))) throw fail('githubLogin', 'This forge login is already linked to another account')
        }
        if ((data.role ?? originalDoc?.role) === 'product-owner') {
          if ((data.enableAPIKey && !originalDoc?.enableAPIKey) || (data.apiKey && data.apiKey !== originalDoc?.apiKey)) throw fail('enableAPIKey', 'A Product owner cannot have an API key')
          if (data.enableAPIKey) data.enableAPIKey = false
        }
        return data
      },
    ],
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
      async ({ data, operation, originalDoc, req }) => {
        if (operation === 'create' && !req.context.oidc && (await req.payload.count({ collection: 'bauherren' })).totalDocs === 0) {
          data.role = 'admin'
        }
        const role = data.role ?? originalDoc?.role
        if (role !== 'product-owner') {
          if (data.role && originalDoc?.role === 'product-owner') data.assignments = []
          else if (data.assignments?.length) throw new ValidationError({ collection: 'bauherren', errors: [{ path: 'assignments', message: 'Only a Product owner has assignments' }] })
          return data
        }
        const rows = assignmentRows(data.assignments ?? originalDoc?.assignments)
        if (data.assignments !== undefined) {
          const err = (message: string) => new ValidationError({ collection: 'bauherren', errors: [{ path: 'assignments', message }] })
          if (new Set(rows.map((r) => r.workspace)).size !== rows.length) throw err('At most one assignment per Workspace')
          for (const r of rows) {
            if (!r.products.length) continue
            const found = await req.payload.count({ collection: 'products', where: { id: { in: r.products }, workspace: { equals: r.workspace } }, overrideAccess: true, req })
            if (found.totalDocs !== new Set(r.products).size) throw err('Products must belong to the Workspace of their assignment')
          }
          if (!isDeepStrictEqual(rows, assignmentRows(originalDoc?.assignments))) data.assignments = rows
        }
        const want = rows.map((r) => r.workspace)
        const have = tenantIds({ tenants: data.tenants ?? originalDoc?.tenants })
        if (want.length !== have.length || want.some((w, i) => w !== have[i])) data.tenants = want.map((tenant) => ({ tenant }))
        return data
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: [...ROLES],
      defaultValue: 'bauherr',
      required: true,
      access: { create: isAdmin, update: isAdmin },
    },
    json('uiPrefs'),
    {
      name: 'assignments',
      type: 'array',
      access: { create: isAdmin, update: isAdmin },
      admin: { description: 'Product owner only: per Workspace, all its Products (scope workspace) or the listed ones (scope products; an empty list grants nothing). Keeps `tenants` equal to the Workspaces listed here.' },
      fields: [rel('workspace', 'workspaces', { required: true }), select('scope', ['workspace', 'products'], { required: true }), rel('products', 'products', { hasMany: true })],
    },
    text('githubLogin', { admin: { description: 'The forge login (GitHub, or GitLab username) linked to this account: a gate label or answers comment from it counts as this person\'s decision, and it is assigned to Tickets when this Bauherr claims a session Run (falls back to BAUHERR_BOT_LOGIN). One account per login, case ignored.' } }),
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
  { access: { create: () => false, update: () => false, delete: () => false, read: ({ req }) => (req.user?.role === 'admin' ? true : isBauherr(req.user as Doc | null) ? { owner: { equals: req.user?.id } } : false) } },
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
    { name: 'budgetUsd30d', type: 'number', defaultValue: 50, min: 0 },
    select('budgetUnit', ['usd', 'tokens'], { defaultValue: 'usd', admin: { description: 'Flips to tokens when the provider has no USD price catalog.' } }),
    { name: 'budgetTokens30d', type: 'number', defaultValue: 20000000, min: 0 },
    { name: 'modelByTier', type: 'json', defaultValue: DEFAULT_MODEL_BY_TIER },
    rel('knowledgeConnection', 'connections', { admin: { description: 'GitHub Connection used to read the Knowledge repo.' } }),
    text('knowledgeRepo', { admin: { description: 'Knowledge repo as owner/name.' } }),
    { name: 'archivedAt', type: 'date', access: { update: () => false }, admin: { readOnly: true, description: 'Set by Delete workspace (lib/workspace-delete.ts): the Workspace is hidden everywhere and does no work.' } },
    { name: 'purgeAt', type: 'date', access: { update: () => false }, admin: { readOnly: true, description: 'Until then an Admin can restore an archived Workspace.' } },
    { name: 'knowledgeIndexed', type: 'json', admin: { readOnly: true, description: 'What the Knowledge index was last built from (Knowledge repo commit, `product:<id>` = Product repo `<repo>@<commit>`, failure back-offs).' } },
  ],
  {
    access: {
      create: isAdmin,
      update: isAdmin,
      delete: isAdmin,
      read: ({ req }) =>
        req.user?.role === 'admin'
          ? true
          : !isBauherr(req.user as Doc | null)
            ? false
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
          const o = { overrideAccess: true, req } as const
          const ws = (await req.payload.findByID({ collection: 'workspaces', id: raw.workspace.id, depth: 0, ...o })) as unknown as {
            gatewayKey: string
            modelByTier: Record<string, string>
            budgetUnit: string
          }
          const conns = await llmConnections(req, raw.workspace.id)
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

export const collections: CollectionConfig[] = [
  bauherren,
  agentKeys,
  workspaces,
  col('products', [
    text('name', { required: true }),
    text('slug', { required: true }),
    text('stagingUrl'),
    text('state', { required: true, defaultValue: 'observing' }),
    date('connectedAt'),
    select('deployMode', ['observe-ci', 'webhook'], { defaultValue: 'observe-ci', required: true }),
    text('deployWebhookUrl'),
    text('deployChecks', { admin: { description: 'Comma-separated check names that must be green; empty = all.' } }),
    { name: 'productionGate', type: 'checkbox', defaultValue: false, admin: { description: 'Accepting on staging waits for an explicit production approval instead of moving to done; the Product\'s own pipeline deploys.' } },
    text('productionWebhookUrl', { admin: { description: 'Optional: POSTed once on production approval; a pipeline may instead react to the bauherr:approved:production label.' } }),
    select('releaseMode', ['notes-only', 'factory', 'manual'], { defaultValue: 'notes-only', required: true, admin: { description: 'notes-only: the Product\'s own tooling makes the release, the factory adds the notes. factory: the factory tags, releases and opens a CHANGELOG.md MR. manual: no automatic release; a person ships it from the forge release flow.' } }),
    text('productionChecks', { admin: { description: 'Comma-separated check names on the merge commit that report the production deploy; required for the production gate.' } }),
    {
      name: 'riskAreas',
      type: 'json',
      defaultValue: [],
      admin: { description: 'Names of path sets whose changes need an owner-approved Brief.' },
    },
    {
      name: 'pathSets',
      type: 'json',
      defaultValue: {},
      validate: (v: unknown) => v == null || (typeof v === 'object' && !Array.isArray(v) && Object.entries(v as object).every(([k, g]) => /^[a-z][a-z0-9-]*$/.test(k) && Array.isArray(g) && g.every((x) => typeof x === 'string' && x.trim() !== '' && !/\s/.test(x)))) || 'must map set names (lowercase, dashes) to lists of path globs without spaces',
      admin: { description: 'Named path sets that conditional workflow steps refer to (`when: {touches: security}`): {name: [globs]}, e.g. {"security": ["src/auth/**"], "ui": ["src/app/**"]}. A set that is empty or not declared never matches.' },
    },
  ], {
    hooks: {
      afterDelete: [
        async ({ id, req }) => {
          const { docs } = await req.payload.find({ collection: 'bauherren', where: { 'assignments.products': { equals: id } }, pagination: false, depth: 0, overrideAccess: true, req })
          for (const u of docs) {
            const assignments = assignmentRows(u.assignments).map((r) => ({ ...r, products: r.products.filter((p) => p !== Number(id)) }))
            await req.payload.update({ collection: 'bauherren', id: u.id, data: { assignments }, overrideAccess: true, depth: 0, req })
          }
        },
      ],
    },
  }),
  connections,
  col('repositories', [text('fullName', { required: true }), rel('product', 'products', { required: true })]),
  col('ticket_sources', [
    text('repo', { required: true }),
    rel('product', 'products', { required: true }),
    rel('connection', 'connections', { required: true }),
    text('cursor'),
    date('lastPolledAt'),
    text('lastError'),
    date('lookbackAt'),
    date('reconciledAt'),
    date('importedAt'),
  ]),
  col('knowledge_chunks', [
    text('source', { required: true, index: true }),
    select('layer', ['workspace', 'product'], { required: true }),
    text('path', { required: true }),
    text('logical', { required: true, index: true }),
    text('product'),
    text('heading'),
    text('text', { required: true }),
    text('commit', { required: true }),
  ]),
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
  col('human_touches', [
    text('kind'),
    text('actor'),
    date('at'),
    text('status'),
    json('detail'),
  ], { access: { create: () => false, update: () => false, delete: () => false }, indexes: [{ fields: ['kind', 'at'] }] }),
  col('instance_state', [text('key', { required: true, unique: true }), json('value')], { access: { read: () => false, create: () => false, update: () => false, delete: () => false } }),
  ...coreCollections,
]

