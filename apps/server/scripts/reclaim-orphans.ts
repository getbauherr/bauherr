import { getPayload } from 'payload'
import config from '../src/payload.config'
import { reclaimStaleJobs } from '../src/jobs'

try {
  const payload = await getPayload({ config })
  console.log(`reclaimed ${await reclaimStaleJobs(payload, Date.now(), 0)} orphaned scheduled job(s)`)
  await payload.destroy()
} catch (e) {
  console.error('reclaim-orphans failed', e)
}
process.exit(0)
