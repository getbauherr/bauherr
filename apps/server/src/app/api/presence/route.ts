import { currentWorkspace, getBauherr, payloadClient } from '../../(app)/lib/session'
import { loadPresence } from '../../../lib/presence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (): Promise<Response> => {
  if (!(await getBauherr())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { workspace } = await currentWorkspace()
  return Response.json(workspace ? await loadPresence(await payloadClient(), workspace.id) : { working: 0, idle: 0 })
}
