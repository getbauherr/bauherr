import { holdsOf, type Hold } from '../../../lib/holds'
import { payloadClient } from './session'

const TTL_MS = 5000
const cache = new Map<number, { at: number; holds: Promise<Hold[]> }>()

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
