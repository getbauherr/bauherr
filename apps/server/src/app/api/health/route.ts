import config from '@payload-config'
import { getPayload } from 'payload'
import { staleTasks } from '../../../lib/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (): Promise<Response> => {
  const stale = await staleTasks(await getPayload({ config }))
  return stale.length ? Response.json({ ok: false, stale }, { status: 503 }) : Response.json({ ok: true })
}
