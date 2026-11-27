import { ANTHROPIC_MODELS, type Def, entry } from './shared'

export const foundryAmbient: Def = {
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
}
