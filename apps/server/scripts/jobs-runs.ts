import { getPayload } from 'payload'
import config from '../src/payload.config'
import { startRunPool } from '../src/lib/run-pool'

const max = Number(process.env.BAUHERR_MAX_RUNS ?? 4)
if (!Number.isInteger(max) || max < 1) {
  console.error('BAUHERR_MAX_RUNS must be a positive integer')
  process.exit(1)
}

const payload = await getPayload({ config })
const pool = startRunPool({ max, intervalMs: 5000, runOne: () => payload.jobs.run({ queue: 'runs', limit: 1 }) })
const shutdown = async () => {
  await pool.stop()
  await payload.destroy()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
