import { type Def, custom, entry } from './shared'

export const mistral: Def = {
  auth: 'file',
  required: [],
  secret: {
    ext: 'key',
    hint:
      'Mistral API key (Studio or Vibe key; draws the plan allowance, then pay-as-you-go). ' +
      'Reasoning models (mistral-large, magistral) are not supported by the gateway yet',
  },
  catalog: true,
  defaultModels: { cheap: 'mistral-small-latest', standard: 'codestral-latest', strong: 'mistral-vibe-cli-latest' },
  render: (slug, _c, file) =>
    entry(
      slug,
      custom('completions', 'mistral'),
      { apiKey: { file }, baseUrl: 'https://api.mistral.ai/v1' },
      { overrides: { metadata: {}, thinking: { type: 'disabled' } } },
    ),
}
