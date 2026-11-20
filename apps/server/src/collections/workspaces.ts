import type { Access, FieldHook } from 'payload'
import { DEFAULT_MODEL_BY_TIER, newKey } from '../lib/gateway'
import { isBauherr } from '../lib/people'
import { encrypt } from '../lib/secrets'
import { isAdmin } from './access'
import { col, rel, select, text } from './fields'
import { seal } from './seal'
import { dropGatewayKey, syncGatewayKey, validateWorkspace } from './workspace-hooks'

const sealGatewayKey: FieldHook = ({ value, operation }) =>
  operation === 'create' && !value ? encrypt(newKey()) : seal(value)

type Tenant = { tenant: { id: number } | number }

const tenantWorkspaceIds = (user: object | null | undefined): number[] =>
  ((user as { tenants?: Tenant[] } | null | undefined)?.tenants ?? []).map((t) =>
    typeof t.tenant === 'object' ? t.tenant.id : t.tenant,
  )

const readWorkspaces: Access = ({ req }) => {
  if (isAdmin({ req })) return true
  if (!isBauherr(req.user)) return false
  return { id: { in: tenantWorkspaceIds(req.user) } }
}

export const workspaces = col(
  'workspaces',
  [
    text('name', { required: true }),
    text('slug', { required: true, unique: true }),
    {
      name: 'gatewayKey',
      type: 'text',
      admin: { description: 'Write-only. Consumer key at the gateway; generated on create, encrypted at rest.' },
      access: { read: () => false },
      hooks: { beforeChange: [sealGatewayKey] },
    },
    { name: 'budgetUsd30d', type: 'number', defaultValue: 50, min: 0 },
    select('budgetUnit', ['usd', 'tokens'], {
      defaultValue: 'usd',
      admin: { description: 'Flips to tokens when the provider has no USD price catalog.' },
    }),
    { name: 'budgetTokens30d', type: 'number', defaultValue: 20000000, min: 0 },
    { name: 'modelByTier', type: 'json', defaultValue: DEFAULT_MODEL_BY_TIER },
    rel('knowledgeConnection', 'connections', {
      admin: { description: 'GitHub Connection used to read the Knowledge repo.' },
    }),
    text('knowledgeRepo', { admin: { description: 'Knowledge repo as owner/name.' } }),
    {
      name: 'archivedAt',
      type: 'date',
      access: { update: () => false },
      admin: {
        readOnly: true,
        description:
          'Set by Delete workspace (lib/workspace-delete.ts): the Workspace is hidden everywhere and does no work.',
      },
    },
    {
      name: 'purgeAt',
      type: 'date',
      access: { update: () => false },
      admin: { readOnly: true, description: 'Until then an Admin can restore an archived Workspace.' },
    },
    {
      name: 'knowledgeIndexed',
      type: 'json',
      admin: {
        readOnly: true,
        description:
          'What the Knowledge index was last built from (Knowledge repo commit, ' +
          '`product:<id>` = Product repo `<repo>@<commit>`, failure back-offs).',
      },
    },
  ],
  {
    access: { create: isAdmin, update: isAdmin, delete: isAdmin, read: readWorkspaces },
    hooks: {
      beforeValidate: [validateWorkspace],
      afterChange: [syncGatewayKey],
      afterDelete: [dropGatewayKey],
    },
  },
)
