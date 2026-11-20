import { getPayload } from 'payload'
import config from '../src/payload.config'
import { maxRuns } from '../src/jobs/runner/deps'
import { runOnce, startPool } from '../src/jobs/runner/pool'

const max = maxRuns()
const payload = await getPayload({ config })
const pool = startPool({ max, intervalMs: 5000, runOne: () => runOnce(payload) })

const shutdown = async () => {
  await pool.stop()
  await payload.destroy()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
