import { type Def, entry } from './shared'

export const gemini: Def = {
  auth: 'file',
  required: [],
  secret: {
    ext: 'key',
    hint: 'Gemini API key; serves Gemini, Chat Completions and Messages calls; set `modelByTier`',
  },
  catalog: true,
  defaultModels: null,
  render: (slug, _c, file) => entry(slug, 'gemini', { apiKey: { file } }),
}
