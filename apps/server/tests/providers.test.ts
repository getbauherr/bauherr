import { expect, it } from 'vitest'
import { missingFields, PRESETS, presetOf, type Preset } from '../src/lib/providers'

const FULL = { baseUrl: 'https://up.example/v1', awsRegion: 'us-east-1', vertexProject: 'p', vertexRegion: 'europe-west1', azureResource: 'res' }
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
  foundry: { provider: 'anthropic', params: { apiKey: { file: FILE }, baseUrl: 'https://res.services.ai.azure.com/anthropic' } },
  'anthropic-compatible': { provider: { custom: { formats: [{ type: 'messages' }] } }, params: { apiKey: { file: FILE }, baseUrl: 'https://up.example/v1' } },
  'openai-compatible': { provider: { custom: { formats: [{ type: 'completions' }] } }, params: { apiKey: { file: FILE }, baseUrl: 'https://up.example/v1' } },
}

it.each(Object.keys(PRESETS) as Preset[])('%s renders its entry with the secret by file reference only', (preset) => {
  const e = PRESETS[preset].render('acme', FULL, FILE)
  expect(e).toEqual({ name: 'ws-acme/*', transformation: { model: 'llmRequest.model.stripPrefix("ws-acme/")' }, ...EXPECTED[preset] })
  expect(JSON.stringify(e)).toContain(FILE)
  expect(JSON.stringify(e)).not.toContain('s3cret')
})

it.each(Object.keys(PRESETS) as Preset[])('%s reports every required key when config is empty', (preset) => {
  expect(missingFields(preset, {})).toEqual(PRESETS[preset].required)
  expect(missingFields(preset, FULL)).toEqual([])
})

it('presetOf defaults to anthropic', () => {
  expect(presetOf(null)).toBe('anthropic')
  expect(presetOf({ provider: 'vertex' })).toBe('vertex')
})
