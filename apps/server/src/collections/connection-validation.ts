import { type PayloadRequest, ValidationError } from 'payload'
import {
  invalidFields,
  missingFields,
  parseIamSecret,
  PRESET_FIELDS,
  PRESETS,
  presetOf,
  type Preset,
} from '../lib/providers'
import { isEncrypted } from '../lib/secrets'
import { isAdmin } from './access'
import { llmConnections, sharedIdentity } from './llm-connections'
import { lockAmbient } from './locks'

type WorkspaceRef = number | { id: number }
export type ConnectionFields = {
  kind?: string
  config?: Record<string, string> | null
  workspace?: WorkspaceRef | null
  slug?: string
  secret?: unknown
}
export type ConnectionDoc = ConnectionFields & { id?: number | string }
type Config = Record<string, string>

const PROVIDER_FIELDS = ['provider', ...PRESET_FIELDS]

export const workspaceIdOf = (workspace: WorkspaceRef): number =>
  typeof workspace === 'object' ? workspace.id : workspace

const connectionError = (errors: { path: string; message: string }[]) =>
  new ValidationError({ collection: 'connections', errors })

export const mergedConfig = (data: ConnectionFields, original: ConnectionDoc | undefined): Config => {
  const config: Config = { ...original?.config, ...data.config }
  const incoming = data as Record<string, unknown>
  const before = (original ?? {}) as Record<string, unknown>
  for (const k of PROVIDER_FIELDS) {
    const prev = before[k] ?? (k === 'provider' ? 'anthropic' : undefined)
    if (incoming[k] != null && incoming[k] !== prev) config[k] = incoming[k] as string
  }
  return config
}

export const assertProviderAllowed = (req: PayloadRequest, config: Config, original: ConnectionDoc | undefined) => {
  const def = PRESETS[presetOf(config)]
  const prevAuth = original?.config ? PRESETS[presetOf(original.config)].auth : 'file'
  if (req.user && !isAdmin({ req }) && (def.auth !== 'file' || prevAuth !== 'file')) {
    throw connectionError([
      { path: 'provider', message: 'inline-secret and ambient providers can be set by Admins only' },
    ])
  }
}

const defaultSlug = (base: string, taken: string[]): string => {
  let slug = base
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`
  return slug
}

const takenSlugs = async (
  req: PayloadRequest,
  data: ConnectionFields,
  original: ConnectionDoc | undefined,
): Promise<string[]> => {
  const workspace = data.workspace ?? original?.workspace
  if (!workspace) return []
  return (await llmConnections(req, workspaceIdOf(workspace)))
    .filter((c) => c.id !== original?.id)
    .map((c) => c.slug as string)
}

const assertSlugAllowed = (slug: string, others: string[], originalSlug: string | undefined): void => {
  if (originalSlug && slug !== originalSlug) {
    throw connectionError([{ path: 'slug', message: 'cannot change after create' }])
  }
  if (!/^[a-z0-9-]+$/.test(slug) || others.includes(slug)) {
    const message = others.includes(slug)
      ? 'already used by another Connection of this Workspace'
      : 'only a-z, 0-9 and -'
    throw connectionError([{ path: 'slug', message }])
  }
}

export const slugOf = async (
  req: PayloadRequest,
  data: ConnectionFields,
  original: ConnectionDoc | undefined,
  config: Config,
): Promise<string> => {
  const others = await takenSlugs(req, data, original)
  const slug = data.slug || original?.slug || defaultSlug(presetOf(config), others)
  assertSlugAllowed(slug, others, original?.slug)
  return slug
}

export const assertConfigComplete = (data: ConnectionFields, config: Config): void => {
  const preset: Preset = presetOf(config)
  const bad = invalidFields(config)
  if (bad.length) throw connectionError(bad.map((path) => ({ path, message: 'malformed value' })))
  if (
    preset === 'bedrock-iam' &&
    typeof data.secret === 'string' &&
    data.secret &&
    !isEncrypted(data.secret) &&
    !parseIamSecret(data.secret)
  ) {
    throw connectionError([
      {
        path: 'secret',
        message:
          'must be JSON {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."} ' +
          '(sessionToken optional)',
      },
    ])
  }
  const missing = missingFields(preset, config)
  if (missing.length) throw connectionError(missing.map((path) => ({ path, message: `required for ${preset}` })))
}

export const assertAmbientAllowed = async (req: PayloadRequest, config: Config): Promise<void> => {
  if (!sharedIdentity(presetOf(config))) return
  await lockAmbient(req)
  if ((await req.payload.count({ collection: 'workspaces', overrideAccess: true, req })).totalDocs !== 1) {
    throw connectionError([
      {
        path: 'provider',
        message:
          'ambient identity is shared by the whole gateway: ' +
          'allowed only while the instance has exactly one Workspace',
      },
    ])
  }
}

export const mirroredFields = (config: Config): Record<string, string> =>
  Object.fromEntries(PROVIDER_FIELDS.filter((k) => config[k] !== undefined).map((k) => [k, config[k]]))
