import { col, date, json, rel, select, text } from './fields'

export const knowledgeChunks = col('knowledge_chunks', [
  text('source', { required: true, index: true }),
  select('layer', ['workspace', 'product'], { required: true }),
  text('path', { required: true }),
  text('logical', { required: true, index: true }),
  text('product'),
  text('heading'),
  text('text', { required: true }),
  text('commit', { required: true }),
])

export const agentSessions = col(
  'agent_sessions',
  [
    { name: 'publicId', type: 'text', required: true, unique: true },
    rel('owner', 'bauherren'),
    rel('agentKey', 'agent_keys'),
    text('role', { required: true, admin: { description: 'A role id of the Workspace workflow.' } }),
    text('label'),
    text('clientKey', {
      admin: { description: 'Stable id the client supplies; the same key reconnects the same row.' },
    }),
    text('clientName'),
    text('clientVersion'),
    text('provider'),
    text('model'),
    date('connectedAt'),
    date('lastSeenAt'),
    date('disconnectedAt'),
    select('endReason', ['disconnect', 'timeout', 'replaced']),
  ],
  {
    indexes: [
      { fields: ['workspace', 'disconnectedAt'] },
      { fields: ['lastSeenAt'] },
      { fields: ['workspace', 'owner', 'clientKey'], unique: true },
    ],
  },
)

export const humanTouches = col(
  'human_touches',
  [text('kind'), text('actor'), date('at'), text('status'), json('detail')],
  {
    access: { create: () => false, update: () => false, delete: () => false },
    indexes: [{ fields: ['kind', 'at'] }],
  },
)

export const instanceState = col('instance_state', [text('key', { required: true, unique: true }), json('value')], {
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
})
