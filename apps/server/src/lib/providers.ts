export type Preset = 'anthropic' | 'greenpt' | 'bedrock' | 'vertex' | 'foundry' | 'anthropic-compatible' | 'openai-compatible'
type Tier = 'cheap' | 'standard' | 'strong'
type Cfg = Record<string, string | undefined>

const ANTHROPIC_MODELS: Record<Tier, string> = { cheap: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }
const custom = (type: 'messages' | 'completions', providerOverride?: string) => ({ custom: { formats: [{ type }], ...(providerOverride && { providerOverride }) } })

type Def = {
  required: string[]
  secret: { ext: 'key' | 'json'; hint: string }
  /** Ships a USD price catalog; otherwise the Workspace budget is in tokens. */
  catalog: boolean
  defaultModels: Record<Tier, string> | null
  render: (slug: string, cfg: Cfg, file: string) => Record<string, unknown>
}

const entry = (slug: string, provider: unknown, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: `ws-${slug}/*`,
  provider,
  params,
  ...extra,
  transformation: { model: `llmRequest.model.stripPrefix("ws-${slug}/")` },
})

export const PRESETS: Record<Preset, Def> = {
  anthropic: {
    required: [],
    secret: { ext: 'key', hint: 'Anthropic API key' },
    catalog: true,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, _c, file) => entry(slug, 'anthropic', { apiKey: { file } }),
  },
  greenpt: {
    required: [],
    secret: { ext: 'key', hint: 'GreenPT API key' },
    catalog: true,
    defaultModels: { cheap: 'glm-5.3-flash', standard: 'glm-5.3', strong: 'kimi-k3' },
    render: (slug, _c, file) => entry(slug, custom('completions', 'greenpt'), { apiKey: { file }, baseUrl: 'https://api.greenpt.ai/v1' }),
  },
  bedrock: {
    required: ['awsRegion'],
    secret: { ext: 'key', hint: 'Bedrock API key; model IDs like us.anthropic.claude-sonnet-5-5-v1:0' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) => entry(slug, 'bedrock', { apiKey: { file }, awsRegion: c.awsRegion }),
  },
  vertex: {
    required: ['vertexProject', 'vertexRegion'],
    secret: { ext: 'json', hint: 'GCP service-account JSON; model IDs like claude-sonnet-5-5@20260101' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) =>
      entry(slug, 'vertex', { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion }, { auth: { gcp: { credential: { file } } } }),
  },
  foundry: {
    required: ['azureResource'],
    secret: { ext: 'key', hint: 'Azure AI Foundry API key (Anthropic models)' },
    catalog: false,
    defaultModels: ANTHROPIC_MODELS,
    render: (slug, c, file) => entry(slug, 'anthropic', { apiKey: { file }, baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` }),
  },
  'anthropic-compatible': {
    required: ['baseUrl'],
    secret: { ext: 'key', hint: 'API key of the Messages endpoint (e.g. an upstream agentgateway consumer key)' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) => entry(slug, custom('messages'), { apiKey: { file }, baseUrl: c.baseUrl }),
  },
  'openai-compatible': {
    required: ['baseUrl'],
    secret: { ext: 'key', hint: 'API key of the Chat Completions endpoint (vLLM, GreenPT-like hosts)' },
    catalog: false,
    defaultModels: null,
    render: (slug, c, file) => entry(slug, custom('completions'), { apiKey: { file }, baseUrl: c.baseUrl }),
  },
}

export const presetOf = (config: { provider?: string } | null | undefined): Preset => (config?.provider as Preset) || 'anthropic'

export const missingFields = (preset: Preset, config: Cfg | null | undefined): string[] => PRESETS[preset].required.filter((k) => !config?.[k])
