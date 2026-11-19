import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

const [mode, url] = process.argv.slice(2) as ['migrate' | 'push', string]
Object.assign(process.env, { DATABASE_URL: url, PAYLOAD_SECRET: 'parity-secret', ENCRYPTION_KEY: 'parity-key' })
if (mode === 'migrate') process.env.BAUHERR_TEST_SCHEMA_READY = '1'
else delete process.env.BAUHERR_TEST_SCHEMA_READY

const { getPayload } = await import('payload')
const payload = await getPayload({ config: (await import('../../src/payload.config')).default })
if (mode === 'migrate') {
  const { migrations } = await import('../../src/migrations')
  const runnable = migrations.map(({ name, up, down }) => ({
    name,
    up: (args: unknown) => up(args as MigrateUpArgs),
    down: (args: unknown) => down(args as MigrateDownArgs),
  }))
  await payload.db.migrate({ migrations: runnable })
  const { syncJobEnums } = await import('../../src/jobs')
  await syncJobEnums(payload)
}
await payload.destroy()
process.exit(0)
