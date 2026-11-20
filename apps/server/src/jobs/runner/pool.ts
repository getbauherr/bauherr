import type { Payload } from 'payload'
import { hasQueuedRun } from './index'

export type Pool = { stop: () => Promise<void> }

export const startPool = (options: { max: number; intervalMs: number; runOne: () => Promise<unknown> }): Pool => {
  let inFlight = 0
  const running = new Set<Promise<unknown>>()
  const tick = () => {
    for (; inFlight < options.max; inFlight++) {
      const one: Promise<unknown> = options
        .runOne()
        .catch((error: unknown) => console.error('run-agent failed', error))
        .finally(() => {
          inFlight--
          running.delete(one)
        })
      running.add(one)
    }
  }
  const timer = setInterval(tick, options.intervalMs)
  tick()
  return {
    stop: async () => {
      clearInterval(timer)
      await Promise.all(running)
    },
  }
}

export const runOnce = async (payload: Payload): Promise<void> => {
  if (!(await hasQueuedRun(payload))) return
  await payload.jobs.queue({ task: 'run-agent', queue: 'runs', input: {} })
  await payload.jobs.run({ queue: 'runs', limit: 1 })
}
