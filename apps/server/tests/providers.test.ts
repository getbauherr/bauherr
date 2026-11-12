import { expect, it } from 'vitest'
import { missingFields, PRESETS, presetOf, type Preset } from '../src/lib/providers'

const FULL = { baseUrl: 'https://up.example/v1', awsRegion: 'us-east-1', vertexProject: 'p', vertexRegion: 'europe-west1', azureResource: 'res', azureTenant: 'tn', azureClient: 'cl' }
const FILE = '/gateway/providers/ws-acme.key'
const EXPECTED: Record<Preset, object> = {
  anthropic: { provider: 'anthropic', params: { apiKey: { file: FILE } } },
  greenpt: {
    provider: { custom: { formats: [{ type: 'completions' }], providerOverride: 'greenpt' } },
    params: { apiKey: { file: FILE }, baseUrl: 'https://api.greenpt.ai/v1' },
  },
  bedrock: { provider: 'bedrock', params: { apiKey: { file: FILE }, awsRegion: 'us-east-1' } },
  vertex: {
    provider: 'vertex',
    params: { vertexProject: 'p', vertexRegion: 'europe-west1' },
    auth: { gcp: { credential: { file: FILE } } },
  },
  openai: { provider: 'openAI', params: { apiKey: { file: FILE } } },
  gemini: { provider: 'gemini', params: { apiKey: { file: FILE } } },
  foundry: { provider: 'anthropic', params: { apiKey: { file: FILE }, baseUrl: 'https://res.services.ai.azure.com/anthropic' } },
  'bedrock-iam': {
    provider: 'bedrock',
    params: { awsRegion: 'us-east-1' },
    auth: { aws: { accessKeyId: 'AKIA', secretAccessKey: 's3cret', sessionToken: 'tok' } },
  },
  'foundry-entra': {
    provider: 'anthropic',
    params: { baseUrl: 'https://res.services.ai.azure.com/anthropic' },
    auth: { azure: { explicitConfig: { clientSecret: { tenant_id: 'tn', client_id: 'cl', client_secret: 's3cret' } } } },
  },
  'bedrock-ambient': { provider: 'bedrock', params: { awsRegion: 'us-east-1' } },
  'vertex-ambient': { provider: 'vertex', params: { vertexProject: 'p', vertexRegion: 'europe-west1' } },
  'foundry-ambient': { provider: 'anthropic', params: { baseUrl: 'https://res.services.ai.azure.com/anthropic' } },
  router: { provider: { custom: { formats: [{ type: 'completions' }] } }, params: { baseUrl: 'http://router:8801/v1' } },
  'anthropic-compatible': { provider: { custom: { formats: [{ type: 'messages' }] } }, params: { apiKey: { file: FILE }, baseUrl: 'https://up.example/v1' } },
  'openai-compatible': { provider: { custom: { formats: [{ type: 'completions' }] } }, params: { apiKey: { file: FILE }, baseUrl: 'https://up.example/v1' } },
}

const SECRETS: Partial<Record<Preset, string>> = {
  'bedrock-iam': JSON.stringify({ accessKeyId: 'AKIA', secretAccessKey: 's3cret', sessionToken: 'tok' }),
  'foundry-entra': 's3cret',
}

it.each(Object.keys(PRESETS) as Preset[])('%s renders its entry; file presets reference the secret by path only, ambient ones carry none', (preset) => {
  const def = PRESETS[preset]
  const e = def.render('acme', FULL, FILE, def.auth === 'inline' ? SECRETS[preset] : undefined)
  expect(e).toEqual({ name: 'ws-acme/*', requestHeaders: { remove: ['x-agw-key', 'x-api-key', 'x-goog-api-key'] }, transformation: { model: 'llmRequest.model.stripPrefix("ws-acme/")' }, ...EXPECTED[preset] })
  expect(JSON.stringify(e).includes(FILE)).toBe(def.auth === 'file')
  expect(JSON.stringify(e).includes('s3cret')).toBe(def.auth === 'inline')
})

it('bedrock-iam omits an absent sessionToken', () => {
  const e = PRESETS['bedrock-iam'].render('acme', FULL, FILE, JSON.stringify({ accessKeyId: 'a', secretAccessKey: 'b' })) as { auth: object }
  expect(e.auth).toEqual({ aws: { accessKeyId: 'a', secretAccessKey: 'b' } })
})

it.each(Object.keys(PRESETS) as Preset[])('%s reports every required key when config is empty', (preset) => {
  expect(missingFields(preset, {})).toEqual(PRESETS[preset].required)
  expect(missingFields(preset, FULL)).toEqual([])
})

it('presetOf defaults to anthropic', () => {
  expect(presetOf(null)).toBe('anthropic')
  expect(presetOf({ provider: 'vertex' })).toBe('vertex')
})
