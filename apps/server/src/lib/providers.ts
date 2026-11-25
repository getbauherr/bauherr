import { z } from 'zod'

export type Preset =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'greenpt'
  | 'mistral'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'anthropic-compatible'
  | 'openai-compatible'
  | 'bedrock-iam'
  | 'foundry-entra'
  | 'bedrock-ambient'
  | 'vertex-ambient'
  | 'foundry-ambient'
type Tier = 'cheap' | 'standard' | 'strong'
type Cfg = Record<string, string | undefined>

const ANTHROPIC_MODELS: Record<Tier, string> = {
  cheap: 'claude-haiku-5-5',
  standard: 'claude-sonnet-5-5',
  strong: 'claude-opus-5-5',
}
const GUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const FIELD_PATTERNS: Partial<Record<(typeof PRESET_FIELDS)[number], RegExp>> = {
  azureResource: /^[a-z0-9-]{1,63}$/i,
  azureTenant: new RegExp(`${GUID.source}|^([a-z0-9-]+\\.)+[a-z]{2,}$`, 'i'),
  azureClient: GUID,
}

export const invalidFields = (config: Cfg | null | undefined): string[] =>
  Object.entries(FIELD_PATTERNS)
    .filter(([k, re]) => config?.[k] != null && config[k] !== '' && !re.test(config[k]))
    .map(([k]) => k)

const iamSecretSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z.string().nullish(),
})

export type IamSecret = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

export const parseIamSecret = (secret: string): IamSecret | null => {
  try {
    const parsed = iamSecretSchema.safeParse(JSON.parse(secret))
    if (!parsed.success) return null
    const { accessKeyId, secretAccessKey, sessionToken } = parsed.data
    return { accessKeyId, secretAccessKey, ...(sessionToken != null && { sessionToken }) }
  } catch {
    return null
  }
}

const custom = (type: 'messages' | 'completions', providerOverride?: string) => ({
  custom: { formats: [{ type }], ...(providerOverride && { providerOverride }) },
})

type Def = {
  auth: 'file' | 'inline' | 'ambient'
  required: string[]
  secret: { ext: 'key' | 'json'; hint: string }
  catalog: boolean
  defaultModels: Record<Tier, string> | null
  render: (slug: string, cfg: Cfg, file: string, secret?: string) => Record<string, unknown>
}

export const KEY_HEADERS = ['x-agw-key', 'x-api-key', 'x-goog-api-key']

const entry = (
  slug: string,
  provider: unknown,
  params: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  name: `ws-${slug}/*`,
  provider,
  params,
  ...extra,
  requestHeaders: { remove: [...KEY_HEADERS] },
  transformation: { model: `llmRequest.model.stripPrefix("ws-${slug}/")` },
})

export const PRESET_FIELDS = [
  'baseUrl',
  'awsRegion',
  'vertexProject',
  'vertexRegion',
  'azureResource',
  'azureTenant',
  'azureClient',
] as const

export const PRESETS: Record<Preset, Def> = {
  anthropic: {
    auth: 'file',
    required: [],
    secret: { ext: 'key', hint: 'Anthropic API key' },
    catalog: true,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, _c, file) => entry(slug, 'anthropic', { apiKey: { file } }),
  },
  openai: {
    auth: 'file',
    required: [],
    secret: {
      ext: 'key',
      hint: 'OpenAI API key; serves Chat Completions and Responses (Codex CLI); set `modelByTier`',
    },
    catalog: true,
    defaultModels: null,
    render: (slug, _c, file) => entry(slug, 'openAI', { apiKey: { file } }),
  },
  gemini: {
    auth: 'file',
    required: [],
    secret: {
      ext: 'key',
      hint: 'Gemini API key; serves Gemini, Chat Completions and Messages calls; set `modelByTier`',
    },
    catalog: true,
    defaultModels: null,
    render: (slug, _c, file) => entry(slug, 'gemini', { apiKey: { file } }),
  },
  greenpt: {
    auth: 'file',
    required: [],
    secret: { ext: 'key', hint: 'GreenPT API key' },
    catalog: true,
    defaultModels: { cheap: 'glm-5.3-flash', standard: 'glm-5.3', strong: 'kimi-k3' },
    render: (slug, _c, file) =>
      entry(slug, custom('completions', 'greenpt'), { apiKey: { file }, baseUrl: 'https://api.greenpt.ai/v1' }),
  },
  mistral: {
    auth: 'file',
    required: [],
    secret: {
      ext: 'key',
      hint:
        'Mistral API key (Studio or Vibe key; draws the plan allowance, then pay-as-you-go). ' +
        'Reasoning models (mistral-large, magistral) are not supported by the gateway yet',
    },
    catalog: true,
    defaultModels: { cheap: 'mistral-small-latest', standard: 'codestral-latest', strong: 'mistral-vibe-cli-latest' },
    render: (slug, _c, file) =>
      entry(
        slug,
        custom('completions', 'mistral'),
        { apiKey: { file }, baseUrl: 'https://api.mistral.ai/v1' },
        { overrides: { metadata: {} } },
      ),
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
      entry(
        slug,
        'vertex',
        { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion },
        { auth: { gcp: { credential: { file } } } },
      ),
  },
  foundry: {
    auth: 'file',
    required: ['azureResource'],
    secret: { ext: 'key', hint: 'Azure AI Foundry API key (Anthropic models)' },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c, file) =>
      entry(slug, 'anthropic', {
        apiKey: { file },
        baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic`,
      }),
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
    secret: {
      ext: 'json',
      hint:
        'AWS IAM key pair as JSON {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."} ' +
        '(sessionToken optional); stored inline in the gateway config.yaml ' +
        '(0600, agentgateway v1.7.0 has no file reference); prefer `bedrock` (API key file)',
    },
    catalog: false,
    defaultModels: null,
    render: (slug, c, _f, secret) => {
      const iam = secret ? parseIamSecret(secret) : null
      if (!iam) throw new Error('bedrock-iam secret is not valid IAM key JSON')
      const { accessKeyId, secretAccessKey, sessionToken } = iam
      return entry(
        slug,
        'bedrock',
        { awsRegion: c.awsRegion },
        { auth: { aws: { accessKeyId, secretAccessKey, ...(sessionToken && { sessionToken }) } } },
      )
    },
  },
  'foundry-entra': {
    auth: 'inline',
    required: ['azureResource', 'azureTenant', 'azureClient'],
    secret: {
      ext: 'key',
      hint:
        'Entra app client secret (Anthropic models on Foundry); stored inline in the gateway config.yaml ' +
        '(0600, agentgateway v1.7.0 has no file reference); prefer `foundry` (API key file)',
    },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c, _f, secret) =>
      entry(
        slug,
        'anthropic',
        { baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` },
        {
          auth: {
            azure: {
              explicitConfig: {
                clientSecret: { tenant_id: c.azureTenant, client_id: c.azureClient, client_secret: secret },
              },
            },
          },
        },
      ),
  },
  'bedrock-ambient': {
    auth: 'ambient',
    required: ['awsRegion'],
    secret: {
      ext: 'key',
      hint: 'none; uses the gateway instance role, shared by the whole gateway (single-Workspace instances only)',
    },
    catalog: false,
    defaultModels: null,
    render: (slug, c) => entry(slug, 'bedrock', { awsRegion: c.awsRegion }),
  },
  'vertex-ambient': {
    auth: 'ambient',
    required: ['vertexProject', 'vertexRegion'],
    secret: {
      ext: 'key',
      hint:
        'none; uses the gateway application-default credentials, shared by the whole gateway ' +
        '(single-Workspace instances only)',
    },
    catalog: false,
    defaultModels: null,
    render: (slug, c) => entry(slug, 'vertex', { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion }),
  },
  'foundry-ambient': {
    auth: 'ambient',
    required: ['azureResource'],
    secret: {
      ext: 'key',
      hint: 'none; uses the gateway managed identity, shared by the whole gateway (single-Workspace instances only)',
    },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c) =>
      entry(slug, 'anthropic', { baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` }),
  },
}

export const presetOf = (config: { provider?: string } | null | undefined): Preset =>
  (config?.provider as Preset) || 'anthropic'

export const missingFields = (preset: Preset, config: Cfg | null | undefined): string[] =>
  PRESETS[preset].required.filter((k) => !config?.[k])
