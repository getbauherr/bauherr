import { ANTHROPIC_MODELS, type Def, entry } from './shared'

export const foundryEntra: Def = {
  auth: 'inline',
  required: ['azureResource', 'azureTenant', 'azureClient'],
  secret: {
    ext: 'key',
    hint:
      'Entra app client secret (Anthropic models on Foundry); stored inline in the gateway config.yaml ' +
      '(0600, agentgateway v1.7.0 has no file reference); prefer `foundry` (API key file)',
  },
  catalog: false,
  defaultModels: ANTHROPIC_MODELS,
  render: (slug, c, _f, secret) =>
    entry(
      slug,
      'anthropic',
      { baseUrl: `https://${c.azureResource}.services.ai.azure.com/anthropic` },
      {
        auth: {
          azure: {
            explicitConfig: {
              clientSecret: { tenant_id: c.azureTenant, client_id: c.azureClient, client_secret: secret },
            },
          },
        },
      },
    ),
}
