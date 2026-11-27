import { type Def, entry } from './shared'

export const vertex: Def = {
  auth: 'file',
  required: ['vertexProject', 'vertexRegion'],
  secret: { ext: 'json', hint: 'GCP service-account JSON; model IDs like claude-sonnet-5-5@20260101' },
  catalog: false,
  defaultModels: null,
  render: (slug, c, file) =>
    entry(
      slug,
      'vertex',
      { vertexProject: c.vertexProject, vertexRegion: c.vertexRegion },
      { auth: { gcp: { credential: { file } } } },
    ),
}
