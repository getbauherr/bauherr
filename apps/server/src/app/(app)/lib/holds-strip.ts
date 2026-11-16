import { holdsOf, type Hold } from '../../../lib/holds'
import { payloadClient } from './session'

const TTL_MS = 5000
const cache = new Map<number, { at: number; holds: Hold[] }>()

/** The Workspace's holds for the shell header, which renders on every page: `holdsOf` runs at most once per `TTL_MS` per Workspace. */
export const loadHolds = async (workspace: number, now = Date.now(), find: typeof holdsOf = holdsOf): Promise<Hold[]> => {
  const hit = cache.get(workspace)
  if (hit && now - hit.at < TTL_MS) return hit.holds
  const holds = await find(await payloadClient(), workspace)
  cache.set(workspace, { at: now, holds })
  return holds
}
