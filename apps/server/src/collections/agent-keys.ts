import { isBauherr } from '../lib/people'
import { isAdmin } from './access'
import { col, date, rel, text } from './fields'

export const agentKeys = col(
  'agent_keys',
  [
    rel('owner', 'bauherren', { required: true, index: true }),
    rel('workspace', 'workspaces', { required: true, index: true }),
    text('label', { required: true }),
    text('keyHash', { required: true, unique: true, hidden: true }),
    text('prefix', {
      required: true,
      admin: { description: 'First characters of the key, to recognise it in lists.' },
    }),
    date('lastUsedAt'),
    date('revokedAt'),
  ],
  {
    access: {
      create: () => false,
      update: () => false,
      delete: () => false,
      read: ({ req }) => (isAdmin({ req }) ? true : isBauherr(req.user) ? { owner: { equals: req.user?.id } } : false),
    },
  },
)
