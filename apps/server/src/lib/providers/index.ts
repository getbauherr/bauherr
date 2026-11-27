import { anthropic } from './anthropic'
import { openai } from './openai'
import { gemini } from './gemini'
import { greenpt } from './greenpt'
import { mistral } from './mistral'
import { bedrock } from './bedrock'
import { vertex } from './vertex'
import { foundry } from './foundry'
import { anthropicCompatible } from './anthropic-compatible'
import { openaiCompatible } from './openai-compatible'
import { bedrockIam } from './bedrock-iam'
import { foundryEntra } from './foundry-entra'
import { bedrockAmbient } from './bedrock-ambient'
import { vertexAmbient } from './vertex-ambient'
import { foundryAmbient } from './foundry-ambient'
import { PRESET_FIELDS, type Cfg, type Def, type Preset } from './shared'

export { parseIamSecret, type IamSecret } from './iam'
export { KEY_HEADERS, PRESET_FIELDS, type Preset } from './shared'

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

export const PRESETS: Record<Preset, Def> = {
  anthropic,
  openai,
  gemini,
  greenpt,
  mistral,
  bedrock,
  vertex,
  foundry,
  'anthropic-compatible': anthropicCompatible,
  'openai-compatible': openaiCompatible,
  'bedrock-iam': bedrockIam,
  'foundry-entra': foundryEntra,
  'bedrock-ambient': bedrockAmbient,
  'vertex-ambient': vertexAmbient,
  'foundry-ambient': foundryAmbient,
}

export const presetOf = (config: { provider?: string } | null | undefined): Preset =>
  (config?.provider as Preset) || 'anthropic'

export const missingFields = (preset: Preset, config: Cfg | null | undefined): string[] =>
  PRESETS[preset].required.filter((k) => !config?.[k])
