import config from '@payload-config'
import { getPayload } from 'payload'
import { staleTasks } from '../../../lib/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (): Promise<Response> => {
  const stale = await staleTasks(await getPayload({ config }))
  const version = process.env.BAUHERR_VERSION || 'dev'
  const commit = process.env.BAUHERR_REVISION?.slice(0, 7) || 'unknown'
  return stale.length
    ? Response.json({ ok: false, stale, version, commit }, { status: 503 })
    : Response.json({ ok: true, version, commit })
}
