import { type Def, entry } from './shared'

export const bedrock: Def = {
  auth: 'file',
  required: ['awsRegion'],
  secret: { ext: 'key', hint: 'Bedrock API key; model IDs like us.anthropic.claude-sonnet-5-5-v1:0' },
  catalog: false,
  defaultModels: null,
  render: (slug, c, file) => entry(slug, 'bedrock', { apiKey: { file }, awsRegion: c.awsRegion }),
}
