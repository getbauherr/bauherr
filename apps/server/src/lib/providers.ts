export type Preset = 'anthropic' | 'greenpt' | 'bedrock' | 'vertex' | 'foundry' | 'anthropic-compatible' | 'openai-compatible' | 'bedrock-iam' | 'foundry-entra' | 'bedrock-ambient' | 'vertex-ambient' | 'foundry-ambient'
type Tier = 'cheap' | 'standard' | 'strong'
type Cfg = Record<string, string | undefined>

const ANTHROPIC_MODELS: Record<Tier, string> = { cheap: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }
const GUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const FIELD_PATTERNS: Partial<Record<(typeof PRESET_FIELDS)[number], RegExp>> = {
  azureResource: /^[a-z0-9-]{1,63}$/i,
  azureTenant: new RegExp(`${GUID.source}|^([a-z0-9-]+\\.)+[a-z]{2,}$`, 'i'),
  azureClient: GUID,
}

/** Names of preset fields whose value is set but malformed; they end up in the gateway baseUrl and auth config. */
export const invalidFields = (config: Cfg | null | undefined): string[] =>
  Object.entries(FIELD_PATTERNS).filter(([k, re]) => config?.[k] != null && config[k] !== '' && !re.test(config[k] as string)).map(([k]) => k)

export type IamSecret = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

/** Parses a bedrock-iam secret; null when malformed. Never surfaces the parser message (it embeds input). */
export const parseIamSecret = (secret: string): IamSecret | null => {
  try {
    const v = JSON.parse(secret)
    const ok = (x: unknown) => typeof x === 'string' && x !== ''
    if (!v || typeof v !== 'object' || !ok(v.accessKeyId) || !ok(v.secretAccessKey) || (v.sessionToken != null && typeof v.sessionToken !== 'string')) return null
    return v
  } catch {
    return null
  }
}

const custom = (type: 'messages' | 'completions', providerOverride?: string) => ({ custom: { formats: [{ type }], ...(providerOverride && { providerOverride }) } })

type Def = {
  /** `file`: secret in a 0600 file next to the config; `inline`: secret rendered into config.yaml; `ambient`: no secret, the gateway's own cloud identity. */
  auth: 'file' | 'inline' | 'ambient'
  required: string[]
  secret: { ext: 'key' | 'json'; hint: string }
  /** Ships a USD price catalog; otherwise the Workspace budget is in tokens. */
  catalog: boolean
  defaultModels: Record<Tier, string> | null
  /** `slug` is `<workspace>/<connection>` (entry `ws-<workspace>/<connection>/*`); `secret` is the decrypted secret, passed for `inline` presets only. */
  render: (slug: string, cfg: Cfg, file: string, secret?: string) => Record<string, unknown>
}

const entry = (slug: string, provider: unknown, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: `ws-${slug}/*`,
  provider,
  params,
  ...extra,
  transformation: { model: `llmRequest.model.stripPrefix("ws-${slug}/")` },
})

export const PRESET_FIELDS = ['baseUrl', 'awsRegion', 'vertexProject', 'vertexRegion', 'azureResource', 'azureTenant', 'azureClient'] as const

export const PRESETS: Record<Preset, Def> = {
  anthropic: {
    auth: 'file',
    required: [],
    secret: { ext: 'key', hint: 'Anthropic API key' },
    catalog: true,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, _c, file) => entry(slug, 'anthropic', { apiKey: { file } }),
  },
  greenpt: {
    auth: 'file',
    required: [],
    secret: { ext: 'key', hint: 'GreenPT API key' },
    catalog: true,
    defaultModels: { cheap: 'glm-5.3-flash', standard: 'glm-5.3', strong: 'kimi-k3' },
    render: (slug, _c, file) => entry(slug, custom('completions', 'greenpt'), { apiKey: { file }, baseUrl: 'https://api.greenpt.ai/v1' }),
  },
  bedrock: {
    auth: 'file',
    required: ['awsRegion'],
    secret: { ext: 'key', hint: 'Bedrock API key; model IDs like us.anthropic.claude-sonnet-5-5-v1:0' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) => entry(slug, 'bedrock', { apiKey: { file }, awsRegion: c.awsRegion }),
  },
  vertex: {
    auth: 'file',
    required: ['vertexProject', 'vertexRegion'],
    secret: { ext: 'json', hint: 'GCP service-account JSON; model IDs like claude-sonnet-5-5@20260101' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) =>
      entry(slug, 'vertex', { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion }, { auth: { gcp: { credential: { file } } } }),
  },
  foundry: {
    auth: 'file',
    required: ['azureResource'],
    secret: { ext: 'key', hint: 'Azure AI Foundry API key (Anthropic models)' },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c, file) => entry(slug, 'anthropic', { apiKey: { file }, baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` }),
  },
  'anthropic-compatible': {
    auth: 'file',
    required: ['baseUrl'],
    secret: { ext: 'key', hint: 'API key of the Messages endpoint (e.g. an upstream agentgateway consumer key)' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) => entry(slug, custom('messages'), { apiKey: { file }, baseUrl: c.baseUrl }),
  },
  'openai-compatible': {
    auth: 'file',
    required: ['baseUrl'],
    secret: { ext: 'key', hint: 'API key of the Chat Completions endpoint (vLLM, GreenPT-like hosts)' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) => entry(slug, custom('completions'), { apiKey: { file }, baseUrl: c.baseUrl }),
  },
  'bedrock-iam': {
    auth: 'inline',
    required: ['awsRegion'],
    secret: { ext: 'json', hint: 'AWS IAM key pair as JSON {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."} (sessionToken optional); stored inline in the gateway config.yaml' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, _f, secret) => {
      const iam = secret ? parseIamSecret(secret) : null
      if (!iam) throw new Error('bedrock-iam secret is not valid IAM key JSON')
      const { accessKeyId, secretAccessKey, sessionToken } = iam
      return entry(slug, 'bedrock', { awsRegion: c.awsRegion }, { auth: { aws: { accessKeyId, secretAccessKey, ...(sessionToken && { sessionToken }) } } })
    },
  },
  'foundry-entra': {
    auth: 'inline',
    required: ['azureResource', 'azureTenant', 'azureClient'],
    secret: { ext: 'key', hint: 'Entra app client secret (Anthropic models on Foundry); stored inline in the gateway config.yaml' },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c, _f, secret) =>
      entry(slug, 'anthropic', { baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` }, {
        auth: { azure: { explicitConfig: { clientSecret: { tenant_id: c.azureTenant, client_id: c.azureClient, client_secret: secret } } } },
      }),
  },
  'bedrock-ambient': {
    auth: 'ambient',
    required: ['awsRegion'],
    secret: { ext: 'key', hint: 'none; uses the gateway instance role, shared by the whole gateway (single-Workspace instances only)' },
    catalog: false,
    defaultModels: null,
    render: (slug, c) => entry(slug, 'bedrock', { awsRegion: c.awsRegion }),
  },
  'vertex-ambient': {
    auth: 'ambient',
    required: ['vertexProject', 'vertexRegion'],
    secret: { ext: 'key', hint: 'none; uses the gateway application-default credentials, shared by the whole gateway (single-Workspace instances only)' },
    catalog: false,
    defaultModels: null,
    render: (slug, c) => entry(slug, 'vertex', { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion }),
  },
  'foundry-ambient': {
    auth: 'ambient',
    required: ['azureResource'],
    secret: { ext: 'key', hint: 'none; uses the gateway managed identity, shared by the whole gateway (single-Workspace instances only)' },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c) => entry(slug, 'anthropic', { baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` }),
  },
}

export const presetOf = (config: { provider?: string } | null | undefined): Preset => (config?.provider as Preset) || 'anthropic'

export const missingFields = (preset: Preset, config: Cfg | null | undefined): string[] => PRESETS[preset].required.filter((k) => !config?.[k])
