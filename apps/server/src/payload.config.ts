import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig, type SanitizedConfig } from 'payload'
import { bauherrOnly, collections, isAdmin } from './collections'
import { TASKS, syncJobEnums } from './jobs'
import { bootFactory } from './lib/factory'
import { migrations } from './migrations'
import { poolOptions } from './lib/db-pool'
import { loginLimits } from './lib/login-lock'
import { secret } from './lib/secrets'

const tenantCollections = Object.fromEntries(
  collections.filter((c) => !['workspaces', 'bauherren', 'agent_keys'].includes(c.slug)).map((c) => [c.slug, {}]),
)

const mediaBucket = process.env.MEDIA_S3_BUCKET
// Fails at boot on a bad LOGIN_IP_MAX_ATTEMPTS / TRUSTED_PROXY_HOPS, like DATABASE_POOL_*.
if (!loginLimits().trustedProxyHops) console.warn('TRUSTED_PROXY_HOPS=0: x-forwarded-for is ignored, so the per-IP sign-in limit is off (the per-account cap still applies)')

/** Payload's own collections (document locks, jobs, migrations, kv) carry its default access, which answers any signed-in account: closed to everyone but Admins and Bauherren. Preferences are keyed to the user already. */
const closeBuiltIns = (config: SanitizedConfig): SanitizedConfig => {
  for (const c of config.collections) if (c.slug.startsWith('payload-') && c.slug !== 'payload-preferences') c.access = { ...c.access, read: bauherrOnly, create: bauherrOnly, update: bauherrOnly, delete: bauherrOnly }
  return config
}

export default buildConfig({
  secret: secret('PAYLOAD_SECRET'),
  serverURL: process.env.PUBLIC_URL,
  // The Factory UI is the product; /admin is a developer escape hatch, off by default: it redirects to /settings and its layout server functions answer 404 unless BAUHERR_ENABLE_ADMIN=1.
  admin: { user: 'bauherren' },
  // People are added, not created: Bauherr (singular) / Bauherren (plural).
  i18n: { translations: { en: { general: { createNew: 'Add', createNewLabel: 'Add {{label}}', addNew: 'Add', addNewLabel: 'Add {{label}}' } } } },
  // GraphQL would be a second, unqueued login path (`loginBauherren`); nothing uses it.
  graphQL: { disable: true },
  typescript: { autoGenerate: false },
  db: postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL, ...poolOptions() }, push: !process.env.BAUHERR_TEST_SCHEMA_READY, prodMigrations: migrations }),
  collections,
  onInit: async (payload) => {
    await syncJobEnums(payload)
    await bootFactory(payload)
  },
  plugins: [
    multiTenantPlugin({
      tenantsSlug: 'workspaces',
      tenantField: { name: 'workspace' },
      collections: tenantCollections as never,
      userHasAccessToAllTenants: (user) => (user as { role?: string }).role === 'admin',
    }),
    // Same code for both stores: MEDIA_S3_BUCKET (+ endpoint, region, keys) switches `media` from the local volume to any S3-compatible bucket. Fields stay in the schema either way (prod runs migrations).
    s3Storage({
      enabled: !!mediaBucket,
      alwaysInsertFields: true,
      collections: { media: true },
      bucket: mediaBucket ?? '',
      config: {
        endpoint: process.env.MEDIA_S3_ENDPOINT || undefined,
        region: process.env.MEDIA_S3_REGION || 'auto',
        forcePathStyle: true,
        credentials: mediaBucket ? { accessKeyId: secret('MEDIA_S3_ACCESS_KEY_ID'), secretAccessKey: secret('MEDIA_S3_SECRET_ACCESS_KEY') } : undefined,
      },
    }),
  ],
  jobs: {
    access: { queue: isAdmin, run: isAdmin, cancel: isAdmin },
    deleteJobOnComplete: false,
    enableConcurrencyControl: true,
    tasks: TASKS,
    // No in-app autoRun: the `poller` (queue poll) and `worker` (queue runs) processes run the jobs (package.json).
  },
}).then(closeBuiltIns)
