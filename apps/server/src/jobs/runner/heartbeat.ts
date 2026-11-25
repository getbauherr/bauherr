import type { NewComment } from '../../core/requests/handover'
import { beat } from '../../core/run/beat'
import type { Claimed } from '../../core/run/leases'
import type { RunnerDeps } from './types'

export const keepAlive = (
  deps: RunnerDeps,
  claimed: Claimed,
  onComments: (comments: NewComment[]) => void,
): (() => void) => {
  const timer = setInterval(() => {
    beat(deps.engine(), claimed.run.id, claimed.token)
      .then(({ newComments }) => {
        if (newComments.length > 0) onComments(newComments)
      })
      .catch(() => undefined)
  }, deps.beatMs)
  return () => clearInterval(timer)
}
