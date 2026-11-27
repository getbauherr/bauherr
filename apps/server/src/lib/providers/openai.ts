import { type Def, entry } from './shared'

export const openai: Def = {
  auth: 'file',
  required: [],
  secret: {
    ext: 'key',
    hint: 'OpenAI API key; serves Chat Completions and Responses (Codex CLI); set `modelByTier`',
  },
  catalog: true,
  defaultModels: null,
  render: (slug, _c, file) => entry(slug, 'openAI', { apiKey: { file } }),
}
