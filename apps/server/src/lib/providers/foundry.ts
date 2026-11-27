import { ANTHROPIC_MODELS, type Def, entry } from './shared'

export const foundry: Def = {
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
}
