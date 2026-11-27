import { type Def, custom, entry } from './shared'

export const greenpt: Def = {
  auth: 'file',
  required: [],
  secret: { ext: 'key', hint: 'GreenPT API key' },
  catalog: true,
  defaultModels: { cheap: 'glm-5.3-flash', standard: 'glm-5.3', strong: 'kimi-k3' },
  render: (slug, _c, file) =>
    entry(slug, custom('completions', 'greenpt'), { apiKey: { file }, baseUrl: 'https://api.greenpt.ai/v1' }),
}
