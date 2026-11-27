import { ANTHROPIC_MODELS, type Def, entry } from './shared'

export const anthropic: Def = {
  auth: 'file',
  required: [],
  secret: { ext: 'key', hint: 'Anthropic API key' },
  catalog: true,
  defaultModels: ANTHROPIC_MODELS,
  render: (slug, _c, file) => entry(slug, 'anthropic', { apiKey: { file } }),
}
