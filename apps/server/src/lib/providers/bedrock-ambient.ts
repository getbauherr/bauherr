import { type Def, entry } from './shared'

export const bedrockAmbient: Def = {
  auth: 'ambient',
  required: ['awsRegion'],
  secret: {
    ext: 'key',
    hint: 'none; uses the gateway instance role, shared by the whole gateway (single-Workspace instances only)',
  },
  catalog: false,
  defaultModels: null,
  render: (slug, c) => entry(slug, 'bedrock', { awsRegion: c.awsRegion }),
}
