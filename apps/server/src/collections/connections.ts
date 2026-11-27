import type { Field } from 'payload'
import { PRESET_FIELDS, PRESETS, type Preset } from '../lib/providers'
import { col, date, json, select, text } from './fields'
import {
  publishConnection,
  refuseDeleteWhileUsedByTier,
  unpublishConnection,
  validateConnection,
} from './connection-hooks'
import { seal } from './seal'

type ProviderData = { provider?: Preset }

const presetField = (name: (typeof PRESET_FIELDS)[number]): Field =>
  text(name, {
    admin: {
      condition: (data: ProviderData) => PRESETS[data.provider ?? 'anthropic'].required.includes(name),
    },
  })

export const connections = col(
  'connections',
  [
    text('name', { required: true }),
    select('kind', ['github', 'gitlab', 'llm-provider'], { required: true }),
    json('config'),
    text('slug', {
      admin: {
        description:
          'Names the Connection in model IDs (ws-<workspace>/<slug>/<model>) and tiers (<slug>/<model>). ' +
          '[a-z0-9-]; default: the provider; fixed after create.',
      },
    }),
    select('provider', Object.keys(PRESETS), {
      defaultValue: 'anthropic',
      admin: {
        description: Object.entries(PRESETS)
          .map(([k, v]) => `${k}: ${v.secret.hint}`)
          .join('\n'),
      },
    }),
    ...PRESET_FIELDS.map(presetField),
    {
      name: 'secret',
      type: 'text',
      admin: {
        description:
          'Write-only. Encrypted at rest; leave empty to keep the stored value. ' +
          'What to paste: see the provider hint. ' +
          'Warning: bedrock-iam and foundry-entra secrets are written in plain text ' +
          'into the gateway config.yaml (0600).',
        condition: (data: ProviderData) => PRESETS[data.provider ?? 'anthropic'].auth !== 'ambient',
      },
      access: { read: () => false },
      hooks: { beforeChange: [({ value }) => seal(value)] },
    },
    {
      name: 'webhookSecret',
      type: 'text',
      admin: { description: 'Write-only. Encrypted at rest; shown once.' },
      access: { read: () => false },
      hooks: { beforeChange: [({ value }) => seal(value)] },
    },
    date('webhookDeliveredAt'),
    json('capabilities'),
    { name: 'forgeLimits', type: 'json', admin: { hidden: true } },
  ],
  {
    indexes: [{ fields: ['workspace', 'slug'], unique: true }],
    hooks: {
      beforeDelete: [refuseDeleteWhileUsedByTier],
      beforeValidate: [validateConnection],
      afterChange: [publishConnection],
      afterDelete: [unpublishConnection],
    },
  },
)
