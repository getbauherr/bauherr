import { handOver, type NewComment } from '../requests/handover'
import type { SubmitDeps } from '../submit'
import { heartbeat } from './leases'
import type { Run } from './schema'

export const beat = async (
  deps: SubmitDeps,
  runId: number,
  token: string,
  step?: string,
): Promise<{ run: Run; newComments: NewComment[] }> => {
  const options = step === undefined ? { now: deps.now } : { now: deps.now, step }
  const run = await heartbeat(deps.payload, runId, token, options)
  return { run, newComments: await handOver(deps.payload, run.recordId, run.id) }
}
