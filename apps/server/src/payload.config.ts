import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig, type SanitizedConfig } from 'payload'
import { bauherrOnly, collections, isAdmin } from './collections'
import { TASKS, syncJobEnums } from './jobs'
import { migrations } from './migrations'
import { poolOptions } from './lib/db-pool'
import { loginLimits } from './lib/login-lock'
import { secret } from './lib/secrets'

const tenantCollections = Object.fromEntries(
  collections
    .filter((c) => !['workspaces', 'bauherren', 'agent_keys', 'instance_state'].includes(c.slug))
    .map((c) => [c.slug, {}]),
)

if (!loginLimits().trustedProxyHops)
  console.warn(
    'TRUSTED_PROXY_HOPS=0: x-forwarded-for is ignored, ' +
      'so the per-IP sign-in limit is off (the per-account cap still applies)',
  )

const closeBuiltIns = (config: SanitizedConfig): SanitizedConfig => {
  for (const c of config.collections)
    if (c.slug.startsWith('payload-') && c.slug !== 'payload-preferences')
      c.access = { ...c.access, read: bauherrOnly, create: bauherrOnly, update: bauherrOnly, delete: bauherrOnly }
  return config
}

export default buildConfig({
  secret: secret('PAYLOAD_SECRET'),
  serverURL: process.env.PUBLIC_URL,
  logger: { options: { level: process.env.LOG_LEVEL || 'info' } },
  admin: { user: 'bauherren' },
  i18n: {
    translations: {
      en: {
        general: { createNew: 'Add', createNewLabel: 'Add {{label}}', addNew: 'Add', addNewLabel: 'Add {{label}}' },
      },
    },
  },
  graphQL: { disable: true },
  typescript: { autoGenerate: false },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL, ...poolOptions() },
    push: !process.env.BAUHERR_TEST_SCHEMA_READY,
    prodMigrations: migrations,
  }),
  collections,
  onInit: async (payload) => {
    await syncJobEnums(payload)
  },
  plugins: [
    multiTenantPlugin({
      tenantsSlug: 'workspaces',
      tenantField: { name: 'workspace' },
      collections: tenantCollections,
      userHasAccessToAllTenants: (user) => (user as { role?: string }).role === 'admin',
    }),
  ],
  jobs: {
    access: { queue: isAdmin, run: isAdmin, cancel: isAdmin },
    deleteJobOnComplete: false,
    enableConcurrencyControl: true,
    tasks: TASKS,
  },
}).then(closeBuiltIns)
