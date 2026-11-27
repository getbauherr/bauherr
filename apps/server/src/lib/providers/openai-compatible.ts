import { type Def, custom, entry } from './shared'

export const openaiCompatible: Def = {
  auth: 'file',
  required: ['baseUrl'],
  secret: { ext: 'key', hint: 'API key of the Chat Completions endpoint (vLLM, GreenPT-like hosts)' },
  catalog: false,
  defaultModels: null,
  render: (slug, c, file) => entry(slug, custom('completions'), { apiKey: { file }, baseUrl: c.baseUrl }),
}
