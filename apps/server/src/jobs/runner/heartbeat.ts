import { heartbeat, type Claimed } from '../../core/run/leases'
import type { RunnerDeps } from './types'

export const keepAlive = (deps: RunnerDeps, claimed: Claimed): (() => void) => {
  const timer = setInterval(() => {
    const engine = deps.engine()
    heartbeat(engine.payload, claimed.run.id, claimed.token, { now: engine.now }).catch(() => undefined)
  }, deps.beatMs)
  return () => clearInterval(timer)
}
