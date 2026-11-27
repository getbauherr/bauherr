import { type Def, entry } from './shared'

export const vertexAmbient: Def = {
  auth: 'ambient',
  required: ['vertexProject', 'vertexRegion'],
  secret: {
    ext: 'key',
    hint:
      'none; uses the gateway application-default credentials, shared by the whole gateway ' +
      '(single-Workspace instances only)',
  },
  catalog: false,
  defaultModels: null,
  render: (slug, c) => entry(slug, 'vertex', { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion }),
}
