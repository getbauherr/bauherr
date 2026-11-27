import { type Def, entry } from './shared'
import { parseIamSecret } from './iam'

export const bedrockIam: Def = {
  auth: 'inline',
  required: ['awsRegion'],
  secret: {
    ext: 'json',
    hint:
      'AWS IAM key pair as JSON {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."} ' +
      '(sessionToken optional); stored inline in the gateway config.yaml ' +
      '(0600, agentgateway v1.7.0 has no file reference); prefer `bedrock` (API key file)',
  },
  catalog: false,
  defaultModels: null,
  render: (slug, c, _f, secret) => {
    const iam = secret ? parseIamSecret(secret) : null
    if (!iam) throw new Error('bedrock-iam secret is not valid IAM key JSON')
    const { accessKeyId, secretAccessKey, sessionToken } = iam
    return entry(
      slug,
      'bedrock',
      { awsRegion: c.awsRegion },
      { auth: { aws: { accessKeyId, secretAccessKey, ...(sessionToken && { sessionToken }) } } },
    )
  },
}
