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
export type Tier = 'cheap' | 'standard' | 'strong'
export type Cfg = Record<string, string | undefined>

export const ANTHROPIC_MODELS: Record<Tier, string> = {
  cheap: 'claude-haiku-5-5',
  standard: 'claude-sonnet-5-5',
  strong: 'claude-opus-5-5',
}

export const custom = (type: 'messages' | 'completions', providerOverride?: string) => ({
  custom: { formats: [{ type }], ...(providerOverride && { providerOverride }) },
})

export type Def = {
  auth: 'file' | 'inline' | 'ambient'
  required: string[]
  secret: { ext: 'key' | 'json'; hint: string }
  catalog: boolean
  defaultModels: Record<Tier, string> | null
  render: (slug: string, cfg: Cfg, file: string, secret?: string) => Record<string, unknown>
}

export const KEY_HEADERS = ['x-agw-key', 'x-api-key', 'x-goog-api-key']

export const entry = (
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
