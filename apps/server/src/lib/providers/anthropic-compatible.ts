import { type Def, custom, entry } from './shared'

export const anthropicCompatible: Def = {
  auth: 'file',
  required: ['baseUrl'],
  secret: { ext: 'key', hint: 'API key of the Messages endpoint (e.g. an upstream agentgateway consumer key)' },
  catalog: false,
  defaultModels: null,
  render: (slug, c, file) => entry(slug, custom('messages'), { apiKey: { file }, baseUrl: c.baseUrl }),
}
