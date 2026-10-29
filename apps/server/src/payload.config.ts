import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig } from 'payload'
import { collections, isAdmin } from './collections'
import { pollTickets, runStage } from './jobs'
import { migrations } from './migrations'
import { secret } from './lib/secrets'

const tenantCollections = Object.fromEntries(
  collections.filter((c) => c.slug !== 'workspaces' && c.slug !== 'bauherren').map((c) => [c.slug, {}]),
)

export default buildConfig({
  secret: secret('PAYLOAD_SECRET'),
  serverURL: process.env.PUBLIC_URL,
  admin: { user: 'bauherren' },
  typescript: { autoGenerate: false },
  db: postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL }, push: true, prodMigrations: migrations }),
  collections,
  plugins: [
    multiTenantPlugin({
      tenantsSlug: 'workspaces',
      tenantField: { name: 'workspace' },
      collections: tenantCollections as never,
      userHasAccessToAllTenants: (user) => (user as { role?: string }).role === 'admin',
    }),
  ],
  jobs: {
    access: { queue: isAdmin, run: isAdmin, cancel: isAdmin },
    deleteJobOnComplete: false,
    enableConcurrencyControl: true,
    tasks: [pollTickets, runStage],
    // The app only polls; agent Runs execute in the worker (`payload jobs:run --queue runs`).
    autoRun: process.env.JOBS_AUTORUN === '0' ? [] : [{ cron: '*/5 * * * * *', queue: 'poll' }],
  },
})
