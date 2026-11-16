import { holdsOf, type Hold } from '../../../lib/holds'
import { payloadClient } from './session'

const TTL_MS = 5000
const cache = new Map<number, { at: number; holds: Promise<Hold[]> }>()

/**
 * The Workspace's holds for the shell header, which renders on every page: `holdsOf` runs at most once per `TTL_MS` per Workspace, concurrent callers share one run,
 * and a failure logs and shows no strip instead of failing the page. A release shows within the TTL (the page refreshes every 5 s).
 */
export const loadHolds = async (workspace: number, now = Date.now(), find: typeof holdsOf = holdsOf): Promise<Hold[]> => {
  let hit = cache.get(workspace)
  if (!hit || now - hit.at >= TTL_MS) {
    hit = { at: now, holds: payloadClient().then((p) => find(p, workspace)) }
    cache.set(workspace, hit)
  }
  try {
    return await hit.holds
  } catch (e) {
    cache.delete(workspace)
    console.error('holds strip: holdsOf failed', e)
    return []
  }
}
