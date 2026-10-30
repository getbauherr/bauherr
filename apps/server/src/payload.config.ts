import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig } from 'payload'
import { collections, isAdmin } from './collections'
import { expireSessions, pollTickets, pruneRequestLogsTask, reconcileCosts, runStage, watchReleaseTask } from './jobs'
import { migrations } from './migrations'
import { secret } from './lib/secrets'

const tenantCollections = Object.fromEntries(
  collections.filter((c) => c.slug !== 'workspaces' && c.slug !== 'bauherren').map((c) => [c.slug, {}]),
)

export default buildConfig({
  secret: secret('PAYLOAD_SECRET'),
  serverURL: process.env.PUBLIC_URL,
  // The Factory UI is the product; /admin is a developer escape hatch (BAUHERR_DISABLE_ADMIN=1 turns it off: the admin page and layout server functions answer 404).
  admin: { user: 'bauherren' },
  // People are added, not created: Bauherr (singular) / Bauherren (plural).
  i18n: { translations: { en: { general: { createNew: 'Add', createNewLabel: 'Add {{label}}', addNew: 'Add', addNewLabel: 'Add {{label}}' } } } },
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
    tasks: [pollTickets, runStage, expireSessions, reconcileCosts, pruneRequestLogsTask, watchReleaseTask],
    // No in-app autoRun: the `poller` (queue poll) and `worker` (queue runs) processes run the jobs (package.json).
  },
})
