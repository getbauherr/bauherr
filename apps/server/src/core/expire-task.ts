import type { Payload, TaskConfig } from 'payload'
import type { AdvanceDeps } from './engine'
import { expireRuns } from './submit'

type Schedule = NonNullable<TaskConfig['schedule']>

export const expireRunsTask = (
  schedule: Schedule,
  depsFor: (payload: Payload) => AdvanceDeps,
): TaskConfig<{ input: Record<string, never>; output: { expired: number } }> => ({
  slug: 'expire-runs',
  schedule,
  retries: 0,
  concurrency: () => 'expire-runs',
  handler: async ({ req }) => ({ output: { expired: (await expireRuns(depsFor(req.payload))).length } }),
})
